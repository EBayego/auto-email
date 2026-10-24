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
      and exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED')
      -- Locks and quota allocation can outlive the initial checks. Re-read
      -- execution controls and the lease at the actual write authorization.
      and (p_job_id is null or (
        public.gmail_execution_allowed(p_user_id,p_account_id)
        and exists(select 1 from public.email_jobs j where j.id=p_job_id and j.user_id=p_user_id
          and j.gmail_account_id=p_account_id and j.thread_id=p_thread_id and j.target_message_id=p_target_message_id
          and j.status='GENERATING' and j.lease_id=p_lease_id and j.lease_expires_at>clock_timestamp())
      ));
  return found;
end;
$$;
