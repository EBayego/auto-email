create function public.email_job_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(case p_from
    when 'PENDING' then p_to = 'CLASSIFYING'
    when 'CLASSIFYING' then p_to in ('PENDING','SKIPPED','GENERATING','REVIEW_REQUIRED','FAILED')
    when 'GENERATING' then p_to in ('DRAFT_CREATED','REVIEW_REQUIRED','FAILED')
    when 'FAILED' then p_to = 'PENDING'
    else false end, false);
$$;

create function public.valid_email_job_classification(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare k text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then return false; end if;
  if not (p_value ?& array['decision','intent','reasons','riskFlags','needsAttachment','source','modelCalls','inputTokens','outputTokens'])
    or p_value - array['decision','intent','reasons','riskFlags','needsAttachment','source','modelCalls','inputTokens','outputTokens'] <> '{}'::jsonb
    or jsonb_typeof(p_value->'decision') is distinct from 'string'
    or jsonb_typeof(p_value->'intent') is distinct from 'string'
    or jsonb_typeof(p_value->'source') is distinct from 'string'
    or p_value->>'decision' not in ('REPLY_REQUIRED','NO_REPLY','UNCERTAIN')
    or p_value->>'intent' not in ('REQUEST_INFORMATION','REQUEST_ACTION','CONFIRMATION','FOLLOW_UP','MEETING','COMPLAINT','FINANCIAL','LEGAL_CONTRACT','NOTIFICATION','UNKNOWN')
    or p_value->>'source' not in ('RULE','MODEL')
    or jsonb_typeof(p_value->'needsAttachment') <> 'boolean'
    or jsonb_typeof(p_value->'reasons') <> 'array' or jsonb_typeof(p_value->'riskFlags') <> 'array' then return false; end if;
  if jsonb_array_length(p_value->'reasons') not between 1 and 32 or jsonb_array_length(p_value->'riskFlags') > 7
    or exists (select 1 from jsonb_array_elements(p_value->'reasons') r
      where jsonb_typeof(r) <> 'string' or r #>> '{}' !~ '^[A-Z][A-Z0-9_]{0,63}$')
    or exists (select 1 from jsonb_array_elements(p_value->'riskFlags') r
      where jsonb_typeof(r) <> 'string' or r #>> '{}' not in ('FINANCIAL','LEGAL_CONTRACT','SENSITIVE_DATA','HUMAN_DECISION','PROMPT_INJECTION','GROUP_RECIPIENTS','ATTACHMENT_REQUIRED')) then return false; end if;
  foreach k in array array['modelCalls','inputTokens','outputTokens'] loop
    if jsonb_typeof(p_value->k) <> 'number' or p_value->>k !~ '^(0|[1-9][0-9]{0,9})$' then return false; end if;
    if (p_value->>k)::numeric > 2147483647 then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  gmail_account_id uuid not null,
  target_message_id text not null check (char_length(target_message_id) between 1 and 512 and target_message_id ~ '^[A-Za-z0-9_-]+$'),
  thread_id text not null check (char_length(thread_id) between 1 and 512 and thread_id ~ '^[A-Za-z0-9_-]+$'),
  status text not null default 'PENDING' check (status in ('PENDING','CLASSIFYING','SKIPPED','GENERATING','DRAFT_CREATED','REVIEW_REQUIRED','FAILED')),
  reason_code text check (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  classification jsonb constraint email_jobs_classification_payload_check check (classification is null or public.valid_email_job_classification(classification)),
  draft_id text check (char_length(draft_id) between 1 and 512 and draft_id ~ '^[A-Za-z0-9_-]+$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_id uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  classification_started_at timestamptz,
  classification_finished_at timestamptz,
  generation_started_at timestamptz,
  generation_finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_account_id, target_message_id),
  unique (id, user_id, gmail_account_id),
  foreign key (gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  constraint email_jobs_lease_check check (
    (lease_id is null) = (lease_expires_at is null) and
    case status when 'CLASSIFYING' then lease_id is not null
      when 'GENERATING' then (generation_started_at is null) = (lease_id is null)
      else lease_id is null end
  ),
  constraint email_jobs_completion_check check (
    (status in ('SKIPPED','DRAFT_CREATED','REVIEW_REQUIRED','FAILED')) = (finished_at is not null)
    and (finished_at is null or started_at is null or finished_at >= started_at)
    and (classification_finished_at is null or (classification_started_at is not null and classification_finished_at >= classification_started_at))
    and (generation_finished_at is null or (generation_started_at is not null and generation_finished_at >= generation_started_at))
  ),
  constraint email_jobs_classification_check check (
    (status not in ('PENDING','CLASSIFYING') or classification is null)
    and (status <> 'SKIPPED' or coalesce(classification->>'decision' = 'NO_REPLY',false))
    and (status not in ('GENERATING','DRAFT_CREATED') or coalesce(classification->>'decision' = 'REPLY_REQUIRED',false))
    and (status <> 'DRAFT_CREATED' or (draft_id is not null and generation_started_at is not null and generation_finished_at is not null))
    and (draft_id is null or status = 'DRAFT_CREATED')
    and (status <> 'FAILED' or reason_code is not null)
  )
);
create unique index email_jobs_draft_idx on public.email_jobs(gmail_account_id,draft_id) where draft_id is not null;
create index email_jobs_pending_idx on public.email_jobs(available_at,created_at,id) where status = 'PENDING';
create index email_jobs_expired_idx on public.email_jobs(lease_expires_at,id) where status in ('CLASSIFYING','GENERATING');
create index email_jobs_owner_idx on public.email_jobs(user_id,gmail_account_id,created_at desc);

create table public.email_job_events (
  id bigint generated always as identity primary key,
  email_job_id uuid not null,
  user_id uuid not null,
  gmail_account_id uuid not null,
  from_status text,
  to_status text not null,
  reason_code text,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (email_job_id,user_id,gmail_account_id) references public.email_jobs(id,user_id,gmail_account_id) on delete cascade,
  check ((from_status is null and to_status = 'PENDING') or public.email_job_transition_allowed(from_status,to_status)),
  check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
create index email_job_events_owner_idx on public.email_job_events(user_id,gmail_account_id,email_job_id,id);
create index email_job_events_job_idx on public.email_job_events(email_job_id,user_id,gmail_account_id);

alter table public.email_jobs enable row level security;
alter table public.email_job_events enable row level security;
create policy email_jobs_select_own on public.email_jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy email_job_events_select_own on public.email_job_events for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.email_jobs,public.email_job_events from public,anon,authenticated;
grant select,insert,update,delete on public.email_jobs,public.email_job_events to service_role;
grant usage,select on sequence public.email_job_events_id_seq to service_role;
revoke all on sequence public.email_job_events_id_seq from public,anon,authenticated;
grant select (id,user_id,gmail_account_id,target_message_id,thread_id,status,reason_code,classification,draft_id,
  attempt_count,available_at,started_at,finished_at,classification_started_at,classification_finished_at,
  generation_started_at,generation_finished_at,created_at,updated_at) on public.email_jobs to authenticated;
grant select on public.email_job_events to authenticated;

create function public.guard_email_job_state() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PENDING' then raise exception 'INVALID_JOB_TRANSITION'; end if;
    return new;
  end if;
  if (new.id,new.user_id,new.gmail_account_id,new.target_message_id,new.thread_id,new.created_at)
    is distinct from (old.id,old.user_id,old.gmail_account_id,old.target_message_id,old.thread_id,old.created_at) then
    raise exception 'IMMUTABLE_JOB_IDENTITY';
  end if;
  if old.classification is not null and new.classification is distinct from old.classification then
    raise exception 'IMMUTABLE_JOB_CLASSIFICATION';
  end if;
  if old.status <> new.status and not public.email_job_transition_allowed(old.status,new.status) then
    raise exception 'INVALID_JOB_TRANSITION';
  end if;
  if old.status = 'FAILED' and new.status = 'PENDING' and (old.classification is not null or old.generation_started_at is not null) then
    raise exception 'JOB_REQUIRES_RECONCILIATION';
  end if;
  return new;
end;
$$;
create function public.track_email_job_state() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.email_job_events(email_job_id,user_id,gmail_account_id,to_status)
      values(new.id,new.user_id,new.gmail_account_id,new.status);
  elsif old.status <> new.status then
    insert into public.email_job_events(email_job_id,user_id,gmail_account_id,from_status,to_status,reason_code)
      values(new.id,new.user_id,new.gmail_account_id,old.status,new.status,new.reason_code);
  end if;
  return new;
end;
$$;
create trigger email_jobs_guard before insert or update on public.email_jobs for each row execute function public.guard_email_job_state();
create trigger email_jobs_touch before update on public.email_jobs for each row execute function public.touch_updated_at();
create trigger email_jobs_track after insert or update on public.email_jobs for each row execute function public.track_email_job_state();

create function public.enqueue_synced_email_job() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.email_jobs(user_id,gmail_account_id,target_message_id,thread_id,created_at)
    values(new.user_id,new.gmail_account_id,new.message_id,new.thread_id,new.detected_at)
    on conflict(gmail_account_id,target_message_id) do nothing;
  return new;
end;
$$;
create trigger gmail_sync_messages_enqueue after insert on public.gmail_sync_messages
  for each row execute function public.enqueue_synced_email_job();
insert into public.email_jobs(user_id,gmail_account_id,target_message_id,thread_id,created_at)
  select user_id,gmail_account_id,message_id,thread_id,detected_at from public.gmail_sync_messages
  on conflict(gmail_account_id,target_message_id) do nothing;

create function public.claim_email_job(p_lease_seconds integer,p_include_generation boolean default false)
returns setof public.email_jobs language plpgsql security invoker set search_path = '' as $$
declare chosen public.email_jobs%rowtype;
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then raise exception 'INVALID_JOB_CONFIGURATION'; end if;
  select j.* into chosen from public.email_jobs j
    join public.gmail_accounts a on a.id = j.gmail_account_id and a.user_id = j.user_id
    join public.users u on u.id = j.user_id join public.user_settings s on s.user_id = j.user_id
    where (j.status = 'PENDING' or (p_include_generation and j.status = 'GENERATING' and j.lease_id is null and j.generation_started_at is null))
      and j.available_at <= clock_timestamp()
      and a.status = 'CONNECTED' and u.status = 'ACTIVE' and s.automation_enabled
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

create function public.renew_email_job(p_user_id uuid,p_account_id uuid,p_job_id uuid,p_lease_id uuid,p_lease_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then raise exception 'INVALID_JOB_CONFIGURATION'; end if;
  update public.email_jobs j set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
      and j.lease_id = p_lease_id and j.lease_expires_at > clock_timestamp() and j.status in ('CLASSIFYING','GENERATING')
      and exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED')
      and exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and exists(select 1 from public.user_settings s where s.user_id = p_user_id and s.automation_enabled);
  return found;
end;
$$;

create function public.advance_email_job(p_user_id uuid,p_account_id uuid,p_job_id uuid,p_lease_id uuid,
  p_expected_status text,p_status text,p_reason_code text default null,p_classification jsonb default null,p_draft_id text default null)
returns setof public.email_jobs language plpgsql security invoker set search_path = '' as $$
declare job public.email_jobs%rowtype; stamp timestamptz := clock_timestamp();
begin
  select * into job from public.email_jobs j where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
    and j.lease_id = p_lease_id and j.lease_expires_at > stamp and j.status = p_expected_status for update;
  if not found then return; end if;
  if not public.email_job_transition_allowed(job.status,p_status) or p_status = 'CLASSIFYING' then raise exception 'INVALID_JOB_TRANSITION'; end if;
  if p_status in ('GENERATING','DRAFT_CREATED','SKIPPED') and (
    not exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED')
    or not exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
    or not exists(select 1 from public.user_settings s where s.user_id = p_user_id and s.automation_enabled)) then raise exception 'JOB_NOT_ACTIVE'; end if;
  if job.status = 'CLASSIFYING' and p_status in ('GENERATING','SKIPPED','REVIEW_REQUIRED') and p_classification is null then
    raise exception 'MISSING_JOB_CLASSIFICATION'; end if;
  return query update public.email_jobs j set status = p_status, reason_code = p_reason_code,
    classification = coalesce(p_classification,j.classification), draft_id = p_draft_id,
    classification_finished_at = case when p_status = 'PENDING' then null when job.status = 'CLASSIFYING' then stamp else j.classification_finished_at end,
    generation_finished_at = case when job.status = 'GENERATING' then stamp else j.generation_finished_at end,
    lease_id = null, lease_expires_at = null,
    finished_at = case when p_status in ('PENDING','GENERATING') then null else stamp end,
    classification_started_at = case when p_status = 'PENDING' then null else j.classification_started_at end
    where j.id = job.id returning j.*;
end;
$$;

create function public.recover_email_jobs(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path = '' as $$
declare job public.email_jobs%rowtype; recovered integer := 0; stamp timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 10000 then raise exception 'INVALID_JOB_CONFIGURATION'; end if;
  for job in select j.* from public.email_jobs j where j.status in ('CLASSIFYING','GENERATING') and j.lease_expires_at <= stamp
    order by j.lease_expires_at,j.id limit p_limit for update skip locked loop
    update public.email_jobs j set
      status = case when job.status = 'CLASSIFYING' then 'PENDING' else 'REVIEW_REQUIRED' end,
      reason_code = case when job.status = 'CLASSIFYING' then 'CLASSIFICATION_INTERRUPTED' else 'GENERATION_INTERRUPTED' end,
      classification_started_at = case when job.status = 'CLASSIFYING' then null else j.classification_started_at end,
      classification_finished_at = case when job.status = 'CLASSIFYING' then null else j.classification_finished_at end,
      generation_finished_at = case when job.status = 'GENERATING' then stamp else null end,
      finished_at = case when job.status = 'GENERATING' then stamp else null end,
      lease_id = null, lease_expires_at = null where j.id = job.id;
    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;

create function public.retry_email_job(p_user_id uuid,p_account_id uuid,p_job_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.email_jobs j set status = 'PENDING', reason_code = 'MANUAL_RETRY', finished_at = null,
    classification_started_at = null, classification_finished_at = null, available_at = clock_timestamp()
    where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
      and j.status = 'FAILED' and j.classification is null and j.generation_started_at is null
      and exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id)
      and exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE');
  return found;
end;
$$;

revoke all on function public.email_job_transition_allowed(text,text), public.valid_email_job_classification(jsonb),
  public.guard_email_job_state(), public.track_email_job_state(), public.enqueue_synced_email_job(),
  public.claim_email_job(integer,boolean), public.renew_email_job(uuid,uuid,uuid,uuid,integer),
  public.advance_email_job(uuid,uuid,uuid,uuid,text,text,text,jsonb,text), public.recover_email_jobs(integer),
  public.retry_email_job(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.email_job_transition_allowed(text,text), public.valid_email_job_classification(jsonb),
  public.guard_email_job_state(), public.track_email_job_state(), public.enqueue_synced_email_job(),
  public.claim_email_job(integer,boolean), public.renew_email_job(uuid,uuid,uuid,uuid,integer),
  public.advance_email_job(uuid,uuid,uuid,uuid,text,text,text,jsonb,text), public.recover_email_jobs(integer),
  public.retry_email_job(uuid,uuid,uuid) to service_role;
