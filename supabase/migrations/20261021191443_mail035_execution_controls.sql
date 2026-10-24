alter table public.gmail_accounts add column manual_sync_requested_at timestamptz;
alter table public.gmail_accounts add column manual_processing_until timestamptz;
create index gmail_accounts_manual_sync_idx on public.gmail_accounts(manual_sync_requested_at,id)
  where status='CONNECTED' and manual_sync_requested_at is not null;
create index draft_generations_daily_usage_idx on public.draft_generations(user_id,(coalesce(write_started_at,created_at)))
  where status in ('CREATED','UNCERTAIN') or write_started_at is not null;

create function public.gmail_execution_allowed(p_user_id uuid,p_account_id uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(select 1 from public.gmail_accounts a
    join public.users u on u.id=a.user_id join public.user_settings s on s.user_id=a.user_id
    where a.id=p_account_id and a.user_id=p_user_id and a.status='CONNECTED' and u.status='ACTIVE'
      and (s.automation_enabled or a.manual_processing_until>clock_timestamp()));
$$;
create function public.daily_draft_usage(p_user_id uuid)
returns bigint language sql volatile security invoker set search_path='' as $$
  -- Uncertain POSTs and active write permits consume quota too. Only a known
  -- cancellation before HTTP can release capacity. UTC defines the daily bucket.
  select count(*) from public.draft_generations d where d.user_id=p_user_id
    and (d.status in ('CREATED','UNCERTAIN') or d.write_started_at is not null)
    and d.status<>'CANCELLED'
    and coalesce(d.write_started_at,d.created_at)>=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC');
$$;

create function public.set_automation_settings(p_user_id uuid,p_enabled boolean,p_poll_seconds integer,p_daily_limit integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_enabled is null or p_poll_seconds is null or p_poll_seconds not between 60 and 86400
    or p_daily_limit is null or p_daily_limit not between 0 and 1000 then raise exception 'INVALID_EXECUTION_SETTINGS'; end if;
  update public.user_settings s set automation_enabled=p_enabled,poll_interval_seconds=p_poll_seconds,max_daily_drafts=p_daily_limit
    where s.user_id=p_user_id and exists(select 1 from public.users u where u.id=p_user_id and u.status='ACTIVE');
  return found;
end;
$$;
create function public.clear_manual_processing() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if not new.automation_enabled then
    update public.gmail_accounts set manual_sync_requested_at=null,manual_processing_until=null where user_id=new.user_id;
  end if;
  return new;
end;
$$;
create trigger user_settings_stop_manual after update of automation_enabled on public.user_settings
  for each row execute function public.clear_manual_processing();

create function public.stop_disconnected_manual_processing() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status<>'CONNECTED' then new.manual_sync_requested_at:=null; new.manual_processing_until:=null; end if;
  return new;
end;
$$;
create trigger gmail_accounts_stop_manual before update of status on public.gmail_accounts
  for each row execute function public.stop_disconnected_manual_processing();

create function public.set_gmail_processing_paused(p_user_id uuid,p_account_id uuid,p_paused boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_paused is null then return false; end if;
  update public.gmail_accounts a set status=case when p_paused then 'PAUSED' else 'CONNECTED' end,
    manual_sync_requested_at=null,manual_processing_until=null
    where a.id=p_account_id and a.user_id=p_user_id and a.status in ('CONNECTED','PAUSED')
      and exists(select 1 from public.users u where u.id=p_user_id and u.status='ACTIVE');
  return found;
end;
$$;
create function public.request_manual_processing(p_user_id uuid,p_account_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.gmail_accounts a set manual_sync_requested_at=coalesce(a.manual_sync_requested_at,clock_timestamp())
    where a.id=p_account_id and a.user_id=p_user_id and a.status='CONNECTED'
      and exists(select 1 from public.users u where u.id=p_user_id and u.status='ACTIVE');
  return found;
end;
$$;

alter table public.draft_generations drop constraint draft_generations_reason_code_check;
alter table public.draft_generations add constraint draft_generations_reason_code_check
  check(reason_code in ('THREAD_CHANGED','PREWRITE_FAILED','GMAIL_WRITE_UNCERTAIN','PERSISTENCE_FAILED','VERIFICATION_FAILED','DAILY_DRAFT_LIMIT'));
alter table public.draft_generations drop constraint draft_generations_result_check;
alter table public.draft_generations add constraint draft_generations_result_check check (
  (status='CREATED' and draft_id is not null and draft_message_id is not null and reason_code is null)
  or (status='CREATING' and draft_id is null and draft_message_id is null and verified_at is null and reason_code is null)
  or (status='UNCERTAIN' and verified_at is null and reason_code is not null)
  or (status='CANCELLED' and draft_id is null and draft_message_id is null and verified_at is null
    and reason_code is not null and reason_code in ('THREAD_CHANGED','PREWRITE_FAILED','DAILY_DRAFT_LIMIT'))
);

revoke all on function public.gmail_execution_allowed(uuid,uuid),public.daily_draft_usage(uuid),
  public.set_automation_settings(uuid,boolean,integer,integer),public.clear_manual_processing(),
  public.set_gmail_processing_paused(uuid,uuid,boolean),public.request_manual_processing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_execution_allowed(uuid,uuid),public.daily_draft_usage(uuid),
  public.set_automation_settings(uuid,boolean,integer,integer),public.clear_manual_processing(),
  public.set_gmail_processing_paused(uuid,uuid,boolean),public.request_manual_processing(uuid,uuid) to service_role;
revoke all on function public.stop_disconnected_manual_processing() from public,anon,authenticated;
grant execute on function public.stop_disconnected_manual_processing() to service_role;

create or replace function public.claim_gmail_sync(p_lease_seconds integer, p_overlap_seconds integer, p_initial_lookback_seconds integer)
 RETURNS TABLE(user_id uuid, gmail_account_id uuid, run_id uuid, window_start_at timestamp with time zone, window_end_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  account public.gmail_accounts%rowtype;
  run public.processing_runs%rowtype;
  since_at timestamptz;
  claimed_at timestamptz := clock_timestamp();
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600
    or p_overlap_seconds is null or p_overlap_seconds not between 1 and 86400
    or p_initial_lookback_seconds is null or p_initial_lookback_seconds not between 60 and 7776000 then
    raise exception 'INVALID_SYNC_CONFIGURATION';
  end if;

  select a.* into account from public.gmail_accounts a
    join public.users u on u.id = a.user_id
    join public.user_settings s on s.user_id = a.user_id
    where a.status = 'CONNECTED' and u.status = 'ACTIVE'
      and (a.manual_sync_requested_at is not null or (a.next_sync_at <= claimed_at and
        (s.automation_enabled or (a.sync_window_start_at is not null and a.manual_processing_until > claimed_at))))
      and (a.sync_lease_expires_at is null or a.sync_lease_expires_at <= claimed_at)
    order by a.manual_sync_requested_at nulls last,a.next_sync_at,a.id limit 1 for update of a skip locked;
  if not found then return; end if;

  if account.sync_lease_id is not null then
    update public.processing_runs r set status = 'FAILED',
      finished_at = greatest(claimed_at, r.started_at), error_count = 1,
      error_code = 'SYNC_INTERRUPTED'
      where r.id = account.sync_lease_id and r.user_id = account.user_id
        and r.gmail_account_id = account.id and r.status = 'RUNNING';
  end if;
  since_at := coalesce(account.sync_window_start_at,
    account.last_sync_at - make_interval(secs => p_overlap_seconds),
    claimed_at - make_interval(secs => p_initial_lookback_seconds));
  insert into public.processing_runs (user_id, gmail_account_id, trigger_kind, started_at)
    values (account.user_id, account.id,
      case when account.manual_sync_requested_at is not null then 'MANUAL'
        when account.sync_window_start_at is null then 'SCHEDULED' else 'RETRY' end,
      claimed_at) returning * into run;
  update public.gmail_accounts a set sync_lease_id = run.id,
    sync_lease_expires_at = claimed_at + make_interval(secs => p_lease_seconds),
    sync_window_start_at = since_at,manual_sync_requested_at=null,
    manual_processing_until=case when account.manual_sync_requested_at is not null
      then claimed_at+interval '15 minutes' else a.manual_processing_until end where a.id = account.id and a.user_id = account.user_id;
  return query select account.user_id, account.id, run.id, since_at, claimed_at;
end;
$function$
;

create or replace function public.renew_gmail_sync(p_user_id uuid, p_account_id uuid, p_run_id uuid, p_lease_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'INVALID_SYNC_CONFIGURATION';
  end if;
  update public.gmail_accounts a
    set sync_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where a.id = p_account_id and a.user_id = p_user_id and a.sync_lease_id = p_run_id
      and a.sync_lease_expires_at > clock_timestamp() and a.status = 'CONNECTED'
      and exists (select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and public.gmail_execution_allowed(p_user_id,p_account_id);
  return found;
end;
$function$
;

create or replace function public.record_gmail_sync_page(p_user_id uuid, p_account_id uuid, p_run_id uuid, p_messages jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  added integer;
begin
  perform 1 from public.gmail_accounts a
    where a.id = p_account_id and a.user_id = p_user_id and a.sync_lease_id = p_run_id
      and a.sync_lease_expires_at > clock_timestamp() and a.status = 'CONNECTED'
      and exists (select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and public.gmail_execution_allowed(p_user_id,p_account_id)
    for update;
  if not found then raise exception 'SYNC_LEASE_LOST'; end if;
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'INVALID_SYNC_MESSAGES';
  end if;
  if jsonb_array_length(p_messages) > 100 or exists (
    select 1 from jsonb_array_elements(p_messages) m
    where jsonb_typeof(m) <> 'object' or m - 'id' - 'threadId' <> '{}'::jsonb
      or jsonb_typeof(m->'id') is distinct from 'string'
      or jsonb_typeof(m->'threadId') is distinct from 'string'
      or char_length(coalesce(m->>'id', '')) not between 1 and 512
      or char_length(coalesce(m->>'threadId', '')) not between 1 and 512
      or coalesce(m->>'id', '') !~ '^[A-Za-z0-9_-]+$'
      or coalesce(m->>'threadId', '') !~ '^[A-Za-z0-9_-]+$'
  ) then raise exception 'INVALID_SYNC_MESSAGES'; end if;
  insert into public.gmail_sync_messages (user_id, gmail_account_id, message_id, thread_id)
    select p_user_id, p_account_id, m->>'id', m->>'threadId'
      from jsonb_array_elements(p_messages) m
    on conflict (gmail_account_id, message_id) do nothing;
  get diagnostics added = row_count;
  update public.processing_runs r set messages_detected = r.messages_detected + added
    where r.id = p_run_id and r.user_id = p_user_id
      and r.gmail_account_id = p_account_id and r.status = 'RUNNING';
  if not found then raise exception 'SYNC_LEASE_LOST'; end if;
  return added;
end;
$function$
;

create or replace function public.finish_gmail_sync(p_user_id uuid, p_account_id uuid, p_run_id uuid, p_success boolean, p_error_code text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  account public.gmail_accounts%rowtype;
  completed_at timestamptz;
  poll_seconds integer;
begin
  if p_success is null or (not p_success and p_error_code is null)
    or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$') then
    raise exception 'INVALID_SYNC_OUTCOME';
  end if;
  select a.* into account from public.gmail_accounts a
    where a.id = p_account_id and a.user_id = p_user_id and a.sync_lease_id = p_run_id
      and a.sync_lease_expires_at > clock_timestamp() for update;
  if not found then return false; end if;
  select s.poll_interval_seconds into poll_seconds from public.user_settings s
    where s.user_id = p_user_id;
  if p_success and (account.status <> 'CONNECTED'
    or not exists (select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
    or not public.gmail_execution_allowed(p_user_id,p_account_id)) then
    raise exception 'SYNC_NOT_ACTIVE';
  end if;
  update public.processing_runs r set status = case when p_success then 'COMPLETED' else 'FAILED' end,
    finished_at = greatest(clock_timestamp(), r.started_at),
    error_count = case when p_success then 0 else 1 end,
    error_code = case when p_success then null else p_error_code end
    where r.id = p_run_id and r.user_id = p_user_id
      and r.gmail_account_id = p_account_id and r.status = 'RUNNING'
    returning r.started_at into completed_at;
  if not found then return false; end if;
  update public.gmail_accounts a set
    last_sync_at = case when p_success then completed_at else a.last_sync_at end,
    sync_window_start_at = case when p_success then null else a.sync_window_start_at end,
    sync_lease_id = null, sync_lease_expires_at = null,
    next_sync_at = clock_timestamp() + make_interval(secs => coalesce(poll_seconds, 300))
    where a.id = p_account_id and a.user_id = p_user_id;
  return true;
end;
$function$
;

create or replace function public.claim_email_job(p_lease_seconds integer,p_include_generation boolean default false)
returns setof public.email_jobs language plpgsql security invoker set search_path = '' as $$
declare chosen public.email_jobs%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then raise exception 'INVALID_JOB_CONFIGURATION'; end if;
  select j.* into chosen from public.email_jobs j
    join public.gmail_accounts a on a.id = j.gmail_account_id and a.user_id = j.user_id
    join public.users u on u.id = j.user_id join public.user_settings s on s.user_id = j.user_id
    where (j.status = 'PENDING' or (p_include_generation and j.status = 'GENERATING' and j.lease_id is null and j.generation_started_at is null))
      and j.available_at <= clock_timestamp()
      and public.gmail_execution_allowed(j.user_id,j.gmail_account_id)
      and (j.status='PENDING' or public.daily_draft_usage(j.user_id)<s.max_daily_drafts)
    order by j.available_at,j.created_at,j.id limit 1 for update of j skip locked;
  if not found then return; end if;
  return query update public.email_jobs j set status = case when chosen.status = 'PENDING' then 'CLASSIFYING' else 'GENERATING' end, lease_id = gen_random_uuid(),
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), attempt_count = attempt_count + 1,
    started_at = coalesce(started_at,clock_timestamp()),
    classification_started_at = case when chosen.status = 'PENDING' then clock_timestamp() else j.classification_started_at end,
    classification_finished_at = case when chosen.status = 'PENDING' then null else j.classification_finished_at end,
    generation_started_at = case when chosen.status = 'GENERATING' then clock_timestamp() else null end,
    reason_code = null where j.id = chosen.id returning j.*;
end;
$$;

create or replace function public.renew_email_job(p_user_id uuid,p_account_id uuid,p_job_id uuid,p_lease_id uuid,p_lease_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then raise exception 'INVALID_JOB_CONFIGURATION'; end if;
  update public.email_jobs j set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
      and j.lease_id = p_lease_id and j.lease_expires_at > clock_timestamp() and j.status in ('CLASSIFYING','GENERATING')
      and exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED')
      and exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and public.gmail_execution_allowed(p_user_id,p_account_id);
  return found;
end;
$$;

create or replace function public.advance_email_job(p_user_id uuid,p_account_id uuid,p_job_id uuid,p_lease_id uuid,
  p_expected_status text,p_status text,p_reason_code text default null,p_classification jsonb default null,p_draft_id text default null)
returns setof public.email_jobs language plpgsql security invoker set search_path = '' as $$
declare job public.email_jobs%rowtype; stamp timestamptz := clock_timestamp();
begin
  select * into job from public.email_jobs j where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
    and j.lease_id = p_lease_id and j.lease_expires_at > stamp and j.status = p_expected_status for update;
  if not found then return; end if;
  if job.lease_expires_at <= clock_timestamp() then return; end if;
  stamp := greatest(clock_timestamp(),job.started_at,job.classification_started_at,job.classification_finished_at,
    job.generation_started_at,job.generation_finished_at);
  if not public.email_job_transition_allowed(job.status,p_status) or p_status = 'CLASSIFYING' then raise exception 'INVALID_JOB_TRANSITION'; end if;
  if job.status = 'GENERATING' and p_status = 'SKIPPED' and not public.email_job_intervention_reason(p_status,p_reason_code) then
    raise exception 'MISSING_INTERVENTION_REASON'; end if;
  if p_status in ('GENERATING','DRAFT_CREATED','SKIPPED') and (
    not exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED')
    or not exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
    or not public.gmail_execution_allowed(p_user_id,p_account_id)) then raise exception 'JOB_NOT_ACTIVE'; end if;
  if job.status = 'CLASSIFYING' and p_status in ('GENERATING','SKIPPED','REVIEW_REQUIRED') and p_classification is null
    and not public.email_job_intervention_reason(p_status,p_reason_code) then raise exception 'MISSING_JOB_CLASSIFICATION'; end if;
  return query update public.email_jobs j set status = p_status,reason_code = p_reason_code,
    classification = coalesce(p_classification,j.classification),draft_id = p_draft_id,
    classification_finished_at = case when p_status = 'PENDING' then null when job.status = 'CLASSIFYING' then stamp else j.classification_finished_at end,
    generation_finished_at = case when job.status = 'GENERATING' then stamp else j.generation_finished_at end,
    lease_id = null,lease_expires_at = null,
    finished_at = case when p_status in ('PENDING','GENERATING') then null else stamp end,
    classification_started_at = case when p_status = 'PENDING' then null else j.classification_started_at end
    where j.id = job.id returning j.*;
end;
$$;

create or replace function public.begin_draft_write(
  p_user_id uuid, p_account_id uuid, p_attempt_id uuid, p_thread_id text,
  p_target_message_id text, p_job_id uuid default null, p_lease_id uuid default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare daily_limit integer;
begin
  if (p_job_id is null) <> (p_lease_id is null) then return false; end if;
  if p_job_id is not null then
    perform 1 from public.email_jobs j
      where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
        and j.thread_id = p_thread_id and j.target_message_id = p_target_message_id
        and j.status = 'GENERATING' and j.lease_id = p_lease_id
        and j.lease_expires_at > clock_timestamp()
        and public.gmail_execution_allowed(p_user_id,p_account_id)
      for update of j;
    if not found then return false; end if;
  end if;
  -- Serialize quota allocation for every account belonging to this user.
  select s.max_daily_drafts into daily_limit from public.user_settings s where s.user_id=p_user_id for update;
  if not found then return false; end if;
  perform 1 from public.draft_generations d where d.id=p_attempt_id and d.user_id=p_user_id
    and d.gmail_account_id=p_account_id and d.thread_id=p_thread_id and d.target_message_id=p_target_message_id
    and d.status='CREATING' and d.write_started_at is null for update;
  if not found then return false; end if;
  if public.daily_draft_usage(p_user_id)>=daily_limit then raise exception 'DAILY_DRAFT_LIMIT'; end if;
  update public.draft_generations d set write_started_at = clock_timestamp()
    where d.id = p_attempt_id and d.user_id = p_user_id and d.gmail_account_id = p_account_id
      and d.thread_id = p_thread_id and d.target_message_id = p_target_message_id
      and d.status = 'CREATING' and d.write_started_at is null
      and exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED');
  return found;
end;
$$;
