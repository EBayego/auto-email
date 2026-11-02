-- Deny access to work history as soon as an application account is disabled.
alter policy email_jobs_select_own on public.email_jobs using (
  (select public.security_access_allowed()) and user_id=(select auth.uid())
  and exists(select 1 from public.users u where u.id=(select auth.uid()) and u.status='ACTIVE')
);
alter policy email_job_events_select_own on public.email_job_events using (
  (select public.security_access_allowed()) and user_id=(select auth.uid())
  and exists(select 1 from public.users u where u.id=(select auth.uid()) and u.status='ACTIVE')
);
alter policy gmail_sync_messages_select_own on public.gmail_sync_messages using (
  (select public.security_access_allowed()) and user_id=(select auth.uid())
  and exists(select 1 from public.users u where u.id=(select auth.uid()) and u.status='ACTIVE')
);

alter table worker_private.security_state enable row level security;

-- Every OAuth attempt must belong to the session's actual Auth user, including
-- writes through service_role. Do not grant the service general Auth-table access.
create function worker_private.guard_oauth_session_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from auth.sessions s where s.id=new.session_id and s.user_id=new.user_id) then
    raise exception 'OAUTH_SESSION_OWNER_MISMATCH' using errcode='23503';
  end if;
  return new;
end;
$$;
revoke all on function worker_private.guard_oauth_session_owner() from public,anon,authenticated,service_role;
delete from public.gmail_oauth_attempts a where not exists(
  select 1 from auth.sessions s where s.id=a.session_id and s.user_id=a.user_id
);
create trigger gmail_oauth_attempts_session_owner before insert or update of user_id,session_id
on public.gmail_oauth_attempts for each row execute function worker_private.guard_oauth_session_owner();

-- Supabase's remaining TRUNCATE/REFERENCES/TRIGGER and sequence UPDATE defaults
-- must not reach new application objects. Each migration grants only what it uses.
alter default privileges for role postgres in schema public revoke all on tables from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public,anon,authenticated;
-- EXECUTE for PUBLIC is a global PostgreSQL default; a schema-only REVOKE
-- cannot remove it. Explicit grants in migrations remain effective.
alter default privileges for role postgres revoke execute on functions from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public,anon,authenticated;
