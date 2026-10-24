create function public.email_job_intervention_reason(p_status text,p_reason text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(case p_status
    when 'SKIPPED' then p_reason in ('EXISTING_MANUAL_DRAFT','EXISTING_SYSTEM_DRAFT','TARGET_ALREADY_PROCESSED','ALREADY_ANSWERED','TARGET_SUPERSEDED','TARGET_NOT_ELIGIBLE')
    when 'REVIEW_REQUIRED' then p_reason in ('DRAFT_RECONCILIATION_REQUIRED','DRAFT_ATTEMPT_CANCELLED','POSSIBLE_EXISTING_REPLY','THREAD_UNVERIFIABLE')
    else false end,false);
$$;
revoke all on function public.email_job_intervention_reason(text,text) from public,anon,authenticated;
grant execute on function public.email_job_intervention_reason(text,text) to service_role;

create or replace function public.email_job_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(case p_from
    when 'PENDING' then p_to = 'CLASSIFYING'
    when 'CLASSIFYING' then p_to in ('PENDING','SKIPPED','GENERATING','REVIEW_REQUIRED','FAILED')
    when 'GENERATING' then p_to in ('SKIPPED','DRAFT_CREATED','REVIEW_REQUIRED','FAILED')
    when 'FAILED' then p_to = 'PENDING'
    else false end,false);
$$;

alter table public.email_jobs drop constraint email_jobs_classification_check;
alter table public.email_jobs add constraint email_jobs_classification_check check (
  (status not in ('PENDING','CLASSIFYING') or classification is null)
  and (status <> 'SKIPPED' or coalesce(classification->>'decision' = 'NO_REPLY',false)
    or public.email_job_intervention_reason(status,reason_code))
  and (status not in ('GENERATING','DRAFT_CREATED') or coalesce(classification->>'decision' = 'REPLY_REQUIRED',false))
  and (status <> 'DRAFT_CREATED' or (draft_id is not null and generation_started_at is not null and generation_finished_at is not null))
  and (draft_id is null or status = 'DRAFT_CREATED')
  and (status <> 'FAILED' or reason_code is not null)
);

create index draft_generations_thread_history_idx on public.draft_generations(gmail_account_id,thread_id);
create index email_jobs_thread_drafts_idx on public.email_jobs(gmail_account_id,thread_id) where status = 'DRAFT_CREATED';

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
    or not exists(select 1 from public.user_settings s where s.user_id = p_user_id and s.automation_enabled)) then raise exception 'JOB_NOT_ACTIVE'; end if;
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

create or replace function public.recover_email_jobs(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path = '' as $$
declare job public.email_jobs%rowtype; recovered integer := 0; stamp timestamptz := clock_timestamp(); stage_stamp timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 10000 then raise exception 'INVALID_JOB_CONFIGURATION'; end if;
  for job in select j.* from public.email_jobs j where j.status in ('CLASSIFYING','GENERATING') and j.lease_expires_at <= stamp
    order by j.lease_expires_at,j.id limit p_limit for update skip locked loop
    stage_stamp := greatest(stamp,job.started_at,job.classification_started_at,job.classification_finished_at,
      job.generation_started_at,job.generation_finished_at);
    update public.email_jobs j set
      status = case when job.status = 'CLASSIFYING' then 'PENDING' else 'REVIEW_REQUIRED' end,
      reason_code = case when job.status = 'CLASSIFYING' then 'CLASSIFICATION_INTERRUPTED' else 'GENERATION_INTERRUPTED' end,
      classification_started_at = case when job.status = 'CLASSIFYING' then null else j.classification_started_at end,
      classification_finished_at = case when job.status = 'CLASSIFYING' then null else j.classification_finished_at end,
      generation_finished_at = case when job.status = 'GENERATING' then stage_stamp else null end,
      finished_at = case when job.status = 'GENERATING' then stage_stamp else null end,
      lease_id = null,lease_expires_at = null where j.id = job.id;
    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;
