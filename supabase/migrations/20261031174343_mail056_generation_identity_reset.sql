-- Privacy erasure may redact identity snapshots; other metadata stays immutable.
grant update(configuration) on public.generation_runs to service_role;
create function public.guard_generation_identity_redaction() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.configuration is distinct from (old.configuration || jsonb_build_object(
    'style',null,'preferences','[]'::jsonb,'preferenceRevisions','[]'::jsonb,'userInstructionsHash',null
  )) then raise exception 'GENERATION_IMMUTABLE'; end if;
  return new;
end;
$$;
create trigger generation_identity_redaction_guard before update of configuration on public.generation_runs
  for each row execute function public.guard_generation_identity_redaction();
revoke all on function public.guard_generation_identity_redaction() from public,anon,authenticated;
grant execute on function public.guard_generation_identity_redaction() to service_role;

create or replace function public.delete_writing_identity(p_user_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  update public.gmail_accounts set status='PAUSED' where user_id=p_user_id and status='CONNECTED';
  perform public.stop_account_work(p_user_id,'STYLE_DELETED');
  delete from public.gmail_onboarding where user_id=p_user_id;
  delete from public.style_preferences where user_id=p_user_id;
  delete from public.style_relationships where user_id=p_user_id;
  delete from public.style_profiles where user_id=p_user_id;
  update public.generation_runs set configuration=configuration || jsonb_build_object(
    'style',null,'preferences','[]'::jsonb,'preferenceRevisions','[]'::jsonb,'userInstructionsHash',null
  ) where user_id=p_user_id;
  insert into public.account_data_events(user_id,action) values(p_user_id,'STYLE_DELETED');
  return true;
end;
$$;
