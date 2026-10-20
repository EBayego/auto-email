alter table public.draft_generations drop constraint draft_generations_prompt_version_check;
alter table public.draft_generations add constraint draft_generations_prompt_version_check
  check (prompt_version in ('mail020-v1', 'mail020-v2', 'mail027-v1'));

create table public.style_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  scope_kind text not null default 'GENERAL',
  scope_key text not null default '',
  preference_key text not null,
  preference_value text not null,
  origin text not null default 'EXPLICIT' check (origin = 'EXPLICIT'),
  revision uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gmail_account_id, scope_kind, scope_key, preference_key),
  constraint style_preferences_owner_fkey foreign key (gmail_account_id, user_id) references public.gmail_accounts(id, user_id) on delete cascade,
  constraint style_preferences_scope_check check (public.valid_style_scope(scope_kind, scope_key)),
  constraint style_preferences_value_check check (
    case preference_key
      when 'greeting' then preference_value in ('short','none','natural')
      when 'language' then preference_value in ('recipient','es','en','fr','de','it','pt','ca')
      when 'length' then preference_value in ('short','medium','long')
      when 'formality' then preference_value in ('informal','neutral','formal')
      when 'closing' then preference_value in ('short','none','natural')
      when 'emojis' then preference_value in ('never','allowed')
      else false
    end
  )
);
create index style_preferences_user_id_idx on public.style_preferences(user_id);
create index style_preferences_account_owner_idx on public.style_preferences(gmail_account_id, user_id);
alter table public.style_preferences enable row level security;
revoke all on public.style_preferences from public, anon, authenticated;
grant select on public.style_preferences to authenticated;
grant select, insert, update, delete on public.style_preferences to service_role;
create policy style_preferences_select_own on public.style_preferences for select to authenticated using (
  (select auth.uid()) = user_id
  and (select exists(select 1 from public.users where id=(select auth.uid()) and status='ACTIVE'))
  and exists(select 1 from public.gmail_accounts a where a.id=gmail_account_id and a.user_id=(select auth.uid()) and a.status='CONNECTED')
);
create function public.version_style_preference() returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP='UPDATE' then
    if row(new.user_id,new.gmail_account_id,new.scope_kind,new.scope_key,new.preference_key,new.origin) is distinct from row(old.user_id,old.gmail_account_id,old.scope_kind,old.scope_key,old.preference_key,old.origin) then
      raise exception using errcode='23514', message='PREFERENCE_OWNER_IMMUTABLE';
    end if;
    new.created_at := old.created_at;
    if new.preference_value is distinct from old.preference_value then new.revision := gen_random_uuid();
    else new.revision := old.revision; end if;
  else
    new.revision := gen_random_uuid();
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.version_style_preference() from public, anon, authenticated;
grant execute on function public.version_style_preference() to service_role;
create trigger style_preferences_version before insert or update on public.style_preferences for each row execute function public.version_style_preference();
