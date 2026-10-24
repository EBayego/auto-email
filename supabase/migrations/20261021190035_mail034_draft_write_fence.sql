alter table public.draft_generations add column write_started_at timestamptz;

create function public.begin_draft_write(
  p_user_id uuid, p_account_id uuid, p_attempt_id uuid, p_thread_id text,
  p_target_message_id text, p_job_id uuid default null, p_lease_id uuid default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if (p_job_id is null) <> (p_lease_id is null) then return false; end if;
  if p_job_id is not null then
    perform 1 from public.email_jobs j
      where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
        and j.thread_id = p_thread_id and j.target_message_id = p_target_message_id
        and j.status = 'GENERATING' and j.lease_id = p_lease_id
        and j.lease_expires_at > clock_timestamp()
        and exists(select 1 from public.user_settings s where s.user_id = p_user_id and s.automation_enabled)
      for update of j;
    if not found then return false; end if;
  end if;
  update public.draft_generations d set write_started_at = clock_timestamp()
    where d.id = p_attempt_id and d.user_id = p_user_id and d.gmail_account_id = p_account_id
      and d.thread_id = p_thread_id and d.target_message_id = p_target_message_id
      and d.status = 'CREATING' and d.write_started_at is null
      and exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED');
  return found;
end;
$$;
revoke all on function public.begin_draft_write(uuid,uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_draft_write(uuid,uuid,uuid,text,text,uuid,uuid) to service_role;
