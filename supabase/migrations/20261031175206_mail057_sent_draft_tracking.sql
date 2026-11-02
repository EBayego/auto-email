alter table public.draft_generations
  add column delivery_envelope_hash text check(delivery_envelope_hash ~ '^[a-f0-9]{64}$'),
  add column draft_internet_message_id text check(char_length(draft_internet_message_id)<=900 and draft_internet_message_id ~ '^<[^<>\s@]+@[^<>\s@]+>$'),
  add column sent_outcome jsonb not null default '{"status":"PENDING","reason":"NOT_CHECKED"}'
    check(octet_length(sent_outcome::text)<=2048 and extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","oneOf":[{"type":"object","properties":{"status":{"type":"string","const":"PENDING"},"reason":{"type":"string","enum":["NOT_CHECKED","DRAFT_PRESENT"]}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"SENT"},"reason":{"type":"string","enum":["MATCHED_MARKER","MATCHED_MESSAGE_ID"]},"messageId":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,512}$"},"sentAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$"}},"required":["status","reason","messageId","sentAt"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"MANUAL_REPLY"},"reason":{"type":"string","const":"SEPARATE_REPLY"},"messageId":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,512}$"},"sentAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$"}},"required":["status","reason","messageId","sentAt"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"INDETERMINATE"},"reason":{"type":"string","enum":["MISSING_DRAFT","UNCORRELATED_REPLY","AMBIGUOUS","CONTEXT_UNAVAILABLE","INVALID_MESSAGE","UNAVAILABLE","IDENTITY_MISMATCH","DRAFT_STILL_PRESENT","ALREADY_ASSOCIATED"]}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"DISCARDED"},"reason":{"type":"string","const":"WRITE_CANCELLED"}},"required":["status","reason"],"additionalProperties":false}]}'::json,sent_outcome)),
  add column sent_checked_at timestamptz,
  add column sent_next_check_at timestamptz not null default now(),
  add column sent_lease_id uuid,
  add column sent_lease_expires_at timestamptz,
  add constraint draft_sent_lease_check check((sent_lease_id is null)=(sent_lease_expires_at is null));
grant select(sent_outcome,sent_checked_at) on public.draft_generations to authenticated;
create index draft_sent_pending_idx on public.draft_generations(sent_next_check_at,id)
  where sent_outcome->>'status' not in ('SENT','DISCARDED');
create unique index draft_sent_message_idx on public.draft_generations(gmail_account_id,(sent_outcome->>'messageId'))
  where sent_outcome->>'status'='SENT';
drop index public.draft_generations_active_thread_idx;
create unique index draft_generations_active_thread_idx on public.draft_generations(gmail_account_id,thread_id)
  where status in ('CREATING','UNCERTAIN') and sent_outcome->>'status'<>'SENT';

create function public.guard_sent_draft_identity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.delivery_envelope_hash is not null and new.delivery_envelope_hash is distinct from old.delivery_envelope_hash then raise exception 'IMMUTABLE_DRAFT_ENVELOPE'; end if;
  if old.sent_outcome->>'status' in ('SENT','DISCARDED') and new.sent_outcome is distinct from old.sent_outcome then raise exception 'IMMUTABLE_SENT_OUTCOME'; end if;
  return new;
end;
$$;
create trigger draft_sent_identity_guard before update of delivery_envelope_hash,sent_outcome on public.draft_generations
  for each row execute function public.guard_sent_draft_identity();

create function public.claim_sent_draft_tracking(p_limit integer default 20,p_lease_seconds integer default 120)
returns setof public.draft_generations language plpgsql security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'INVALID_TRACKING_CONFIGURATION'; end if;
  return query with chosen as (
    select d.id from public.draft_generations d
    join public.users u on u.id=d.user_id and u.status='ACTIVE'
    join public.gmail_accounts a on a.id=d.gmail_account_id and a.user_id=d.user_id and a.status='CONNECTED'
    where d.sent_outcome->>'status' not in ('SENT','DISCARDED')
      and (d.write_started_at is not null or d.status='CANCELLED') and d.created_at<clock_timestamp()-interval '2 minutes'
      and d.sent_next_check_at<=clock_timestamp()
      and (d.sent_lease_id is null or d.sent_lease_expires_at<=clock_timestamp())
      and (d.reconciliation_lease_id is null or d.reconciliation_lease_expires_at<=clock_timestamp())
      and not exists(select 1 from public.email_jobs j where j.user_id=d.user_id and j.gmail_account_id=d.gmail_account_id and j.target_message_id=d.target_message_id and j.lease_id is not null and j.lease_expires_at>clock_timestamp())
    order by d.sent_next_check_at,d.id limit p_limit for update of d skip locked
  ) update public.draft_generations d set sent_lease_id=gen_random_uuid(),sent_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    from chosen where d.id=chosen.id returning d.*;
end;
$$;
create function public.finish_sent_draft_tracking(p_user_id uuid,p_account_id uuid,p_attempt_id uuid,p_lease_id uuid,p_outcome jsonb,p_draft_internet_message_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare attempt public.draft_generations%rowtype; result jsonb:=p_outcome;
begin
  if p_outcome is null or octet_length(p_outcome::text)>2048 or not extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","oneOf":[{"type":"object","properties":{"status":{"type":"string","const":"PENDING"},"reason":{"type":"string","enum":["NOT_CHECKED","DRAFT_PRESENT"]}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"SENT"},"reason":{"type":"string","enum":["MATCHED_MARKER","MATCHED_MESSAGE_ID"]},"messageId":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,512}$"},"sentAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$"}},"required":["status","reason","messageId","sentAt"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"MANUAL_REPLY"},"reason":{"type":"string","const":"SEPARATE_REPLY"},"messageId":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,512}$"},"sentAt":{"type":"string","format":"date-time","pattern":"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$"}},"required":["status","reason","messageId","sentAt"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"INDETERMINATE"},"reason":{"type":"string","enum":["MISSING_DRAFT","UNCORRELATED_REPLY","AMBIGUOUS","CONTEXT_UNAVAILABLE","INVALID_MESSAGE","UNAVAILABLE","IDENTITY_MISMATCH","DRAFT_STILL_PRESENT","ALREADY_ASSOCIATED"]}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"DISCARDED"},"reason":{"type":"string","const":"WRITE_CANCELLED"}},"required":["status","reason"],"additionalProperties":false}]}'::json,p_outcome) then raise exception 'INVALID_SENT_OUTCOME'; end if;
  if p_draft_internet_message_id is not null and (char_length(p_draft_internet_message_id)>900 or p_draft_internet_message_id !~ '^<[^<>\s@]+@[^<>\s@]+>$') then raise exception 'INVALID_MESSAGE_ID'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  perform 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED' for share;
  if not found then return false; end if;
  select * into attempt from public.draft_generations where id=p_attempt_id and user_id=p_user_id and gmail_account_id=p_account_id
    and sent_lease_id=p_lease_id and sent_lease_expires_at>clock_timestamp() and sent_outcome->>'status' not in ('SENT','DISCARDED') for update;
  if not found or attempt.sent_lease_expires_at<=clock_timestamp() then return false; end if;
  if exists(select 1 from public.email_jobs j where j.user_id=p_user_id and j.gmail_account_id=p_account_id and j.target_message_id=attempt.target_message_id and j.lease_id is not null and j.lease_expires_at>clock_timestamp()) then return false; end if;
  if p_outcome->>'status' in ('SENT','MANUAL_REPLY') then
    if attempt.write_started_at is null or attempt.delivery_intent is null
      or (p_outcome->>'sentAt')::timestamptz<date_trunc('second',attempt.write_started_at)
      or (p_outcome->>'sentAt')::timestamptz>clock_timestamp()+interval '1 minute' then raise exception 'INVALID_SENT_OUTCOME'; end if;
    if p_outcome->>'status'='MANUAL_REPLY' and (attempt.draft_id is null or attempt.delivery_envelope_hash is null) then raise exception 'INVALID_SENT_OUTCOME'; end if;
  elsif p_outcome->>'status'='DISCARDED' and (attempt.status<>'CANCELLED' or attempt.write_started_at is not null) then raise exception 'INVALID_SENT_OUTCOME'; end if;
  begin
    update public.draft_generations set sent_outcome=result where id=attempt.id;
  exception when unique_violation then
    result:='{"status":"INDETERMINATE","reason":"ALREADY_ASSOCIATED"}'::jsonb;
    update public.draft_generations set sent_outcome=result where id=attempt.id;
  end;
  update public.draft_generations set sent_checked_at=clock_timestamp(),
    sent_next_check_at=clock_timestamp()+case when created_at<clock_timestamp()-interval '7 days' then interval '1 hour' else interval '5 minutes' end,
    sent_lease_id=null,sent_lease_expires_at=null,
    draft_internet_message_id=case when p_draft_internet_message_id is not null and draft_id is not null and result->>'status' in ('PENDING','MANUAL_REPLY') then p_draft_internet_message_id else draft_internet_message_id end
    where id=attempt.id;
  return true;
end;
$$;
revoke all on function public.guard_sent_draft_identity(),public.claim_sent_draft_tracking(integer,integer),public.finish_sent_draft_tracking(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.guard_sent_draft_identity(),public.claim_sent_draft_tracking(integer,integer),public.finish_sent_draft_tracking(uuid,uuid,uuid,uuid,jsonb,text) to service_role;

-- Completed send tracking resolves an uncertain write without inventing draft IDs.
create or replace function public.claim_draft_reconciliation(p_limit integer default 20,p_lease_seconds integer default 120)
returns setof public.draft_generations language plpgsql security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'INVALID_RECONCILIATION_CONFIGURATION'; end if;
  return query with chosen as (
    select d.id from public.draft_generations d
    join public.users u on u.id=d.user_id and u.status='ACTIVE'
    join public.gmail_accounts a on a.id=d.gmail_account_id and a.user_id=d.user_id and a.status='CONNECTED'
    where d.status in ('CREATING','UNCERTAIN','CREATED') and d.sent_outcome->>'status'<>'SENT' and d.created_at<clock_timestamp()-interval '2 minutes'
      and d.reconciliation_next_at<=clock_timestamp() and (d.reconciliation_lease_id is null or d.reconciliation_lease_expires_at<=clock_timestamp())
      and (d.sent_lease_id is null or d.sent_lease_expires_at<=clock_timestamp())
      and (d.status<>'CREATED' or exists(select 1 from public.email_jobs j where j.id=d.email_job_id and j.status<>'DRAFT_CREATED'))
      and not exists(select 1 from public.email_jobs j where j.user_id=d.user_id and j.gmail_account_id=d.gmail_account_id and j.target_message_id=d.target_message_id and j.lease_id is not null and j.lease_expires_at>clock_timestamp())
    order by d.reconciliation_next_at,d.id limit p_limit for update of d skip locked
  ) update public.draft_generations d set reconciliation_lease_id=gen_random_uuid(),reconciliation_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    from chosen where d.id=chosen.id returning d.*;
end;
$$;
