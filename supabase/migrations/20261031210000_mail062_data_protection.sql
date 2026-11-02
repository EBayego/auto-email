create table worker_private.security_state (
  singleton boolean primary key default true check(singleton),
  maintenance boolean not null default false
);
insert into worker_private.security_state(singleton) values(true);
revoke all on worker_private.security_state from public,anon,authenticated,service_role;
grant select,update on worker_private.security_state to service_role;
create function public.security_access_allowed() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from worker_private.security_state where singleton and not maintenance);
$$;
revoke all on function public.security_access_allowed() from public,anon;
grant execute on function public.security_access_allowed() to authenticated,service_role;

-- Service processes also check the global hold; RLS protects direct client reads.
do $$ declare policy record; statement text; begin
  for policy in select * from pg_policies where schemaname='public' or (schemaname='storage' and tablename='objects' and policyname='knowledge_documents_read_own') loop
    statement:=format('alter policy %I on %I.%I',policy.policyname,policy.schemaname,policy.tablename);
    if policy.qual is not null then statement:=statement||format(' using ((select public.security_access_allowed()) and (%s))',policy.qual); end if;
    if policy.with_check is not null then statement:=statement||format(' with check ((select public.security_access_allowed()) and (%s))',policy.with_check); end if;
    if policy.qual is not null or policy.with_check is not null then execute statement; end if;
  end loop;
end $$;
create or replace function public.privacy_authorization_valid(p_user_id uuid,p_notice_hash text default null)
returns boolean language sql stable security invoker set search_path='' as $$
  select public.security_access_allowed() and exists(select 1 from public.privacy_authorizations p join public.users u on u.id=p.user_id and u.status='ACTIVE'
    where p.user_id=p_user_id and p.notice_version='mail061-v1' and p.withdrawn_at is null and (p_notice_hash is null or p.notice_hash=p_notice_hash));
$$;
create function public.contain_security_incident() returns boolean language plpgsql security invoker set search_path='' as $$
declare owner_id uuid;
begin
  update worker_private.security_state set maintenance=true where singleton;
  for owner_id in select id from public.users where status='ACTIVE' order by id for update loop
    update public.gmail_accounts set status='PAUSED',credential_version=gen_random_uuid(),encrypted_access_token=null,
      access_token_expires_at=null,token_lease_id=null,token_lease_expires_at=null where user_id=owner_id and status in ('CONNECTED','PAUSED');
    perform public.stop_account_work(owner_id,'ACCOUNT_DISCONNECTED');
    delete from public.generation_content_authorizations where user_id=owner_id;
  end loop;
  return true;
end;
$$;
create function public.release_security_hold(p_reviewed boolean) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_reviewed is distinct from true then raise exception 'REVIEW_REQUIRED'; end if;
  update worker_private.security_state set maintenance=false where singleton;
  -- Account pauses and disabled automation are intentionally retained.
  return true;
end;
$$;

-- Recover external erasure intents without changing existing receipts.
create function public.recover_erasure_request(p_user_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id for update;
  if not found or exists(select 1 from public.account_deletion_requests where user_id=p_user_id) then return; end if;
  update public.users set status='DELETION_PENDING' where id=p_user_id and status='DISABLED';
  -- Recovery must not rotate a receipt returned by a concurrent web request.
  perform public.request_account_deletion(p_user_id,encode(extensions.gen_random_bytes(32),'hex'));
end;
$$;

-- Keep only a one-way target fingerprint and thread reference for deduplication
-- after deleting rich generation/job history. No message bodies or recipients.
create table public.archived_drafts (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  target_hash text not null check(target_hash ~ '^[a-f0-9]{64}$'),
  thread_id text not null,
  sent boolean not null,
  archived_at timestamptz not null default clock_timestamp(),
  unique(gmail_account_id,target_hash),
  foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade
);
alter table public.archived_drafts enable row level security;
create index archived_drafts_owner_idx on public.archived_drafts(user_id);
create index archived_drafts_account_owner_idx on public.archived_drafts(gmail_account_id,user_id);
revoke all on public.archived_drafts from public,anon,authenticated,service_role;
grant select,insert,delete on public.archived_drafts to service_role;
create function public.find_archived_draft(p_user_id uuid,p_account_id uuid,p_target_message_id text)
returns table(id uuid,thread_id text,sent boolean) language sql stable security invoker set search_path='' as $$
  select d.id,d.thread_id,d.sent from public.archived_drafts d where d.user_id=p_user_id and d.gmail_account_id=p_account_id
    and d.target_hash=encode(extensions.digest(p_account_id::text||':'||p_target_message_id,'sha256'),'hex');
$$;
create function public.guard_archived_draft() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.archived_drafts d where d.gmail_account_id=new.gmail_account_id and d.user_id=new.user_id
    and d.target_hash=encode(extensions.digest(new.gmail_account_id::text||':'||new.target_message_id,'sha256'),'hex')) then
    raise exception 'TARGET_ALREADY_PROCESSED' using errcode='23505';
  end if;
  return new;
end;
$$;
create trigger draft_generations_archived_guard before insert on public.draft_generations for each row execute function public.guard_archived_draft();

create index gmail_oauth_attempts_expiry_idx on public.gmail_oauth_attempts(expires_at);
create index feedback_events_retention_idx on public.feedback_events(created_at);
create index response_validation_retention_idx on public.response_validation_events(created_at);
create index response_policy_retention_idx on public.response_policy_events(created_at);
create index email_job_events_retention_idx on public.email_job_events(occurred_at);
-- Fixed maintenance routine: callers can run the purge, but receive no raw Auth
-- table privileges or general permission to delete immutable audit events.
create function public.purge_private_data() returns void language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz:=clock_timestamp()-interval '90 days'; owner record;
begin
  if not pg_try_advisory_xact_lock(597062) then return; end if;
  perform public.purge_generation_content();
  perform public.purge_account_audit();
  delete from public.gmail_oauth_attempts where expires_at<=clock_timestamp();
  update public.gmail_accounts set encrypted_access_token=null,access_token_expires_at=null
    where access_token_expires_at<=clock_timestamp() and (token_lease_expires_at is null or token_lease_expires_at<=clock_timestamp());
  delete from public.style_learning_proposals where created_at<clock_timestamp()-interval '30 days';
  delete from public.feedback_events where created_at<cutoff and (lease_expires_at is null or lease_expires_at<=clock_timestamp());
  insert into public.archived_drafts(id,user_id,gmail_account_id,target_hash,thread_id,sent)
    select d.id,d.user_id,d.gmail_account_id,encode(extensions.digest(d.gmail_account_id::text||':'||d.target_message_id,'sha256'),'hex'),d.thread_id,coalesce(d.sent_outcome->>'status'='SENT',false)
    from public.draft_generations d where d.created_at<cutoff
      and (d.reconciliation_lease_expires_at is null or d.reconciliation_lease_expires_at<=clock_timestamp())
      and (d.sent_lease_expires_at is null or d.sent_lease_expires_at<=clock_timestamp())
      and not exists(select 1 from public.email_jobs j where j.id=d.email_job_id and j.lease_expires_at>clock_timestamp())
    on conflict(gmail_account_id,target_hash) do nothing;
  delete from public.draft_generations d using public.archived_drafts a where a.id=d.id and a.user_id=d.user_id and a.gmail_account_id=d.gmail_account_id;
  delete from public.generation_runs r where r.created_at<cutoff and not exists(select 1 from public.draft_generations d where d.generation_run_id=r.id)
    and not exists(select 1 from public.email_jobs j where j.id=r.email_job_id and j.lease_expires_at>clock_timestamp());
  delete from public.email_job_events where occurred_at<clock_timestamp()-interval '30 days';
  delete from public.response_policy_events where created_at<clock_timestamp()-interval '30 days';
  delete from public.response_validation_events where created_at<clock_timestamp()-interval '30 days';
  delete from public.email_jobs j where j.created_at<cutoff and j.status in ('SKIPPED','DRAFT_CREATED','REVIEW_REQUIRED','FAILED')
    and not exists(select 1 from public.draft_generations d where d.email_job_id=j.id)
    and not exists(select 1 from public.generation_runs r where r.email_job_id=j.id);
  delete from public.gmail_sync_messages where detected_at<cutoff;
  delete from public.processing_runs where status<>'RUNNING' and finished_at<cutoff;
  for owner in select a.user_id,a.id from public.gmail_accounts a join auth.users u on u.id=a.user_id
    where exists(select 1 from public.style_profiles p where p.gmail_account_id=a.id)
      and greatest(a.created_at,a.last_sync_at,u.last_sign_in_at,(select max(p.generated_at) from public.style_profiles p where p.gmail_account_id=a.id))<cutoff
    order by a.user_id for update of a
  loop
    update public.gmail_accounts set status='PAUSED' where id=owner.id and status='CONNECTED';
    perform public.stop_account_work(owner.user_id,'STYLE_DELETED');
    delete from public.style_profiles where user_id=owner.user_id and gmail_account_id=owner.id;
    delete from public.gmail_onboarding where user_id=owner.user_id;
  end loop;
end;
$$;
revoke all on function public.contain_security_incident(),public.release_security_hold(boolean),public.recover_erasure_request(uuid),public.find_archived_draft(uuid,uuid,text),public.guard_archived_draft(),public.purge_private_data() from public,anon,authenticated;
grant execute on function public.contain_security_incident(),public.release_security_hold(boolean),public.recover_erasure_request(uuid),public.find_archived_draft(uuid,uuid,text),public.guard_archived_draft(),public.purge_private_data() to service_role;
select cron.schedule('mail062-purge-private-data','*/5 * * * *','select public.purge_private_data()');
