alter table public.draft_generations
  add column knowledge_revision text check(knowledge_revision ~ '^[a-f0-9]{32}$');

create function public.guard_draft_knowledge_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.knowledge_revision is distinct from old.knowledge_revision then
    raise exception 'IMMUTABLE_KNOWLEDGE_REVISION' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger draft_generation_knowledge_revision_guard before update of knowledge_revision on public.draft_generations
  for each row execute function public.guard_draft_knowledge_revision();
revoke all on function public.guard_draft_knowledge_revision() from public,anon,authenticated;
grant execute on function public.guard_draft_knowledge_revision() to service_role;
create or replace function public.begin_draft_write(
  p_user_id uuid, p_account_id uuid, p_attempt_id uuid, p_thread_id text,
  p_target_message_id text, p_job_id uuid default null, p_lease_id uuid default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare daily_limit integer; generated_revision text; current_revision text; generated_knowledge_revision text;
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
  select s.max_daily_drafts,md5(s.response_policy::text) into daily_limit,current_revision from public.user_settings s where s.user_id=p_user_id for update;
  if not found then return false; end if;
  perform 1 from public.draft_generations d where d.id=p_attempt_id and d.user_id=p_user_id
    and d.gmail_account_id=p_account_id and d.thread_id=p_thread_id and d.target_message_id=p_target_message_id
    and d.status='CREATING' and d.write_started_at is null for update;
  if not found then return false; end if;
  select d.policy_revision,d.knowledge_revision into generated_revision,generated_knowledge_revision from public.draft_generations d where d.id=p_attempt_id;
  if not exists(select 1 from public.users where id=p_user_id and status='ACTIVE') then return false; end if;
  if (generated_revision is not null and generated_revision is distinct from current_revision) or
    (generated_knowledge_revision is not null and generated_knowledge_revision is distinct from (public.get_knowledge_source_configuration(p_user_id)->>'revision')) then
    insert into public.response_policy_events(user_id,gmail_account_id,evaluation_id,thread_id,target_message_id,policy_revision,engine_version,phase,action,reasons)
      values(p_user_id,p_account_id,gen_random_uuid(),p_thread_id,p_target_message_id,current_revision,'mail045-v1','POSTFLIGHT','REVIEW_REQUIRED',array['POLICY_CHANGED']);
    return false;
  end if;
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

