create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.provision_app_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_anonymous is not true then
    insert into public.users (id) values (new.id)
    on conflict (id) do nothing;

    insert into public.user_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.provision_app_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.provision_app_user();

insert into public.users (id)
select id from auth.users where is_anonymous is not true
on conflict (id) do nothing;

insert into public.user_settings (user_id)
select id from public.users
on conflict (user_id) do nothing;

grant select (id, status) on public.users to authenticated;
grant select (user_id, automation_enabled, poll_interval_seconds, max_daily_drafts)
  on public.user_settings to authenticated;
