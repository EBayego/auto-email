alter table public.draft_generations
  add column email_job_id uuid,
  add column delivery_intent jsonb,
  add column reconciliation_lease_id uuid,
  add column reconciliation_lease_expires_at timestamptz,
  add column reconciliation_next_at timestamptz not null default now(),
  add column reconciliation_checked_at timestamptz,
  add column reconciliation_result text check(reconciliation_result in ('FOUND','EDITED','MISSING','AMBIGUOUS','UNAVAILABLE','NOT_STARTED','UNCONFIRMED')),
  add constraint draft_generation_job_fk foreign key(email_job_id,user_id,gmail_account_id) references public.email_jobs(id,user_id,gmail_account_id) deferrable initially deferred,
  add constraint draft_generation_reconcile_lease_check check((reconciliation_lease_id is null)=(reconciliation_lease_expires_at is null)),
  add constraint draft_generation_intent_check check(delivery_intent is null or (
    octet_length(delivery_intent::text)<=4096 and extensions.jsonb_matches_schema('{
      "type":"object","additionalProperties":false,"required":["version","internetMessageId","inReplyTo","fingerprint"],
      "properties":{"version":{"const":"mail048-v1"},"internetMessageId":{"type":"string","maxLength":900,"pattern":"^<[^<>\\s@]+@[^<>\\s@]+>$"},
        "inReplyTo":{"type":"string","maxLength":900,"pattern":"^<[^<>\\s@]+@[^<>\\s@]+>$"},"fingerprint":{"type":"string","pattern":"^[a-f0-9]{64}$"}}
    }'::json,delivery_intent)
  ));
create unique index draft_generation_job_idx on public.draft_generations(email_job_id,user_id,gmail_account_id);
create unique index draft_generation_google_id_idx on public.draft_generations(gmail_account_id,draft_id) where draft_id is not null;
create index draft_generation_reconciliation_idx on public.draft_generations(reconciliation_next_at,id) where status in ('CREATING','UNCERTAIN','CREATED');
revoke select on public.draft_generations from authenticated;
grant select(id,user_id,gmail_account_id,thread_id,target_message_id,status,draft_id,draft_message_id,verified_at,reason_code,
  style_revision,model,prompt_version,input_tokens,output_tokens,created_at,updated_at,write_started_at,sources_used,policy_revision,factual_validation,
  email_job_id,reconciliation_checked_at,reconciliation_result) on public.draft_generations to authenticated;

create function public.guard_draft_delivery() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (old.delivery_intent is not null or old.email_job_id is not null) then
    if (new.id,new.user_id,new.gmail_account_id,new.thread_id,new.target_message_id,new.email_job_id,new.delivery_intent)
      is distinct from (old.id,old.user_id,old.gmail_account_id,old.thread_id,old.target_message_id,old.email_job_id,old.delivery_intent) then
      raise exception 'IMMUTABLE_DRAFT_IDENTITY';
    end if;
    if old.write_started_at is not null and new.write_started_at is distinct from old.write_started_at then raise exception 'IMMUTABLE_DRAFT_WRITE'; end if;
    if old.draft_id is not null and new.draft_id is distinct from old.draft_id then raise exception 'IMMUTABLE_GMAIL_DRAFT'; end if;
  end if;
  if new.email_job_id is not null and not exists(select 1 from public.email_jobs j where j.id=new.email_job_id and j.user_id=new.user_id
    and j.gmail_account_id=new.gmail_account_id and j.thread_id=new.thread_id and j.target_message_id=new.target_message_id) then
    raise exception 'DRAFT_JOB_MISMATCH' using errcode='23514';
  end if;
  if new.delivery_intent is not null and new.delivery_intent->>'internetMessageId' is distinct from '<mail021.'||new.id::text||'@auto-email.invalid>' then
    raise exception 'DRAFT_CORRELATION_MISMATCH' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger draft_generation_delivery_guard before insert or update on public.draft_generations for each row execute function public.guard_draft_delivery();
revoke all on function public.guard_draft_delivery() from public,anon,authenticated;
grant execute on function public.guard_draft_delivery() to service_role;

create function public.claim_draft_reconciliation(p_limit integer default 20,p_lease_seconds integer default 120)
returns setof public.draft_generations language plpgsql security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'INVALID_RECONCILIATION_CONFIGURATION'; end if;
  return query with chosen as (
    select d.id from public.draft_generations d
    join public.users u on u.id=d.user_id and u.status='ACTIVE'
    join public.gmail_accounts a on a.id=d.gmail_account_id and a.user_id=d.user_id and a.status='CONNECTED'
    where d.status in ('CREATING','UNCERTAIN','CREATED') and d.created_at<clock_timestamp()-interval '2 minutes'
      and d.reconciliation_next_at<=clock_timestamp() and (d.reconciliation_lease_id is null or d.reconciliation_lease_expires_at<=clock_timestamp())
      and (d.status<>'CREATED' or exists(select 1 from public.email_jobs j where j.id=d.email_job_id and j.status<>'DRAFT_CREATED'))
      and not exists(select 1 from public.email_jobs j where j.user_id=d.user_id and j.gmail_account_id=d.gmail_account_id
        and j.target_message_id=d.target_message_id and j.lease_id is not null and j.lease_expires_at>clock_timestamp())
    order by d.reconciliation_next_at,d.id limit p_limit for update of d skip locked
  ) update public.draft_generations d set reconciliation_lease_id=gen_random_uuid(),
    reconciliation_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    from chosen where d.id=chosen.id returning d.*;
end;
$$;

create or replace function public.guard_email_job_state() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'PENDING' then raise exception 'INVALID_JOB_TRANSITION'; end if;
    return new;
  end if;
  if (new.id,new.user_id,new.gmail_account_id,new.target_message_id,new.thread_id,new.created_at)
    is distinct from (old.id,old.user_id,old.gmail_account_id,old.target_message_id,old.thread_id,old.created_at) then raise exception 'IMMUTABLE_JOB_IDENTITY'; end if;
  if old.classification is not null and new.classification is distinct from old.classification then raise exception 'IMMUTABLE_JOB_CLASSIFICATION'; end if;
  if old.status<>new.status and not public.email_job_transition_allowed(old.status,new.status) and not (
    old.status in ('REVIEW_REQUIRED','SKIPPED') and new.status='DRAFT_CREATED' and new.reason_code='DRAFT_RECONCILED'
    and old.classification->>'decision'='REPLY_REQUIRED' and old.generation_started_at is not null
    and exists(select 1 from public.draft_generations d where d.email_job_id=old.id and d.user_id=old.user_id and d.gmail_account_id=old.gmail_account_id
      and d.status='CREATED' and d.draft_id=new.draft_id and d.reconciliation_result in ('FOUND','EDITED'))
  ) then raise exception 'INVALID_JOB_TRANSITION'; end if;
  if old.status='FAILED' and new.status='PENDING' and (old.classification is not null or old.generation_started_at is not null) then raise exception 'JOB_REQUIRES_RECONCILIATION'; end if;
  return new;
end;
$$;

alter table public.email_job_events drop constraint email_job_events_check,
  add constraint email_job_events_check check ((from_status is null and to_status='PENDING') or public.email_job_transition_allowed(from_status,to_status)
    or (from_status in ('REVIEW_REQUIRED','SKIPPED') and to_status='DRAFT_CREATED' and reason_code='DRAFT_RECONCILED'));

create function public.finish_draft_reconciliation(p_user_id uuid,p_account_id uuid,p_attempt_id uuid,p_lease_id uuid,
  p_result text,p_draft_id text default null,p_message_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare attempt public.draft_generations%rowtype; job_id uuid; stamp timestamptz;
begin
  if p_result is null or p_result not in ('FOUND','EDITED','MISSING','AMBIGUOUS','UNAVAILABLE','NOT_STARTED','UNCONFIRMED') then raise exception 'INVALID_RECONCILIATION_RESULT'; end if;
  select d.email_job_id into job_id from public.draft_generations d where d.id=p_attempt_id and d.user_id=p_user_id and d.gmail_account_id=p_account_id;
  if job_id is not null then perform 1 from public.email_jobs j where j.id=job_id for update; end if;
  select d.* into attempt from public.draft_generations d where d.id=p_attempt_id and d.user_id=p_user_id and d.gmail_account_id=p_account_id
    and d.reconciliation_lease_id=p_lease_id and d.reconciliation_lease_expires_at>clock_timestamp() for update;
  if not found or attempt.reconciliation_lease_expires_at<=clock_timestamp() or not exists(select 1 from public.users u where u.id=p_user_id and u.status='ACTIVE')
    or not exists(select 1 from public.gmail_accounts a where a.id=p_account_id and a.user_id=p_user_id and a.status='CONNECTED') then return false; end if;
  if exists(select 1 from public.email_jobs j where j.user_id=p_user_id and j.gmail_account_id=p_account_id and j.target_message_id=attempt.target_message_id
    and j.lease_id is not null and j.lease_expires_at>clock_timestamp()) then return false; end if;
  if p_result in ('FOUND','EDITED') then
    if attempt.write_started_at is null or p_draft_id is null or p_message_id is null
      or char_length(p_draft_id) not between 1 and 512 or p_draft_id !~ '^[A-Za-z0-9_-]+$'
      or char_length(p_message_id) not between 1 and 512 or p_message_id !~ '^[A-Za-z0-9_-]+$'
      or (attempt.draft_id is not null and attempt.draft_id<>p_draft_id) then raise exception 'INVALID_RECONCILIATION_RESULT'; end if;
    update public.draft_generations set status='CREATED',draft_id=p_draft_id,draft_message_id=p_message_id,reason_code=null,
      verified_at=case when p_result='FOUND' then clock_timestamp() else null end where id=attempt.id;
  elsif p_draft_id is not null or p_message_id is not null then raise exception 'INVALID_RECONCILIATION_RESULT';
  elsif p_result='NOT_STARTED' then
    if attempt.write_started_at is not null then raise exception 'INVALID_RECONCILIATION_RESULT'; end if;
    update public.draft_generations set status='CANCELLED',reason_code='PREWRITE_FAILED' where id=attempt.id and status='CREATING';
  end if;
  update public.draft_generations set reconciliation_result=p_result,reconciliation_checked_at=clock_timestamp(),
    reconciliation_next_at=clock_timestamp()+interval '5 minutes',reconciliation_lease_id=null,reconciliation_lease_expires_at=null where id=attempt.id;
  if p_result in ('FOUND','EDITED') and job_id is not null then
    stamp:=clock_timestamp();
    update public.email_jobs j set status='DRAFT_CREATED',reason_code='DRAFT_RECONCILED',draft_id=p_draft_id,
      generation_finished_at=greatest(stamp,j.generation_started_at,j.generation_finished_at),
      finished_at=greatest(stamp,j.started_at,j.classification_finished_at,j.generation_started_at,j.generation_finished_at),lease_id=null,lease_expires_at=null
      where j.id=job_id and j.status in ('GENERATING','REVIEW_REQUIRED','SKIPPED') and j.classification->>'decision'='REPLY_REQUIRED' and j.generation_started_at is not null;
  end if;
  return true;
end;
$$;
revoke all on function public.claim_draft_reconciliation(integer,integer),public.finish_draft_reconciliation(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_draft_reconciliation(integer,integer),public.finish_draft_reconciliation(uuid,uuid,uuid,uuid,text,text,text) to service_role;
