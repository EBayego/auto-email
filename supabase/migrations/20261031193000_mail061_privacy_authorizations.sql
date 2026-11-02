create table public.privacy_authorizations (
  user_id uuid primary key references public.users(id) on delete cascade,
  notice_version text not null check(notice_version='mail061-v1'),
  notice_hash text not null check(notice_hash ~ '^[a-f0-9]{64}$'),
  notice_text text not null check(octet_length(notice_text) between 100 and 30000),
  accepted_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  check(withdrawn_at is null or withdrawn_at>=accepted_at)
);
create table public.privacy_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null check(action in ('GRANTED','WITHDRAWN')),
  notice_version text not null,
  notice_hash text not null check(notice_hash ~ '^[a-f0-9]{64}$'),
  notice_text text not null check(octet_length(notice_text) between 100 and 30000),
  created_at timestamptz not null default clock_timestamp()
);
create index privacy_events_owner_idx on public.privacy_events(user_id,created_at desc,id);
alter table public.privacy_authorizations enable row level security;
alter table public.privacy_events enable row level security;
revoke all on public.privacy_authorizations,public.privacy_events from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.privacy_authorizations to service_role;
grant select,insert,delete on public.privacy_events to service_role;

create function public.privacy_authorization_valid(p_user_id uuid,p_notice_hash text default null)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.privacy_authorizations p join public.users u on u.id=p.user_id and u.status='ACTIVE'
    where p.user_id=p_user_id and p.notice_version='mail061-v1' and p.withdrawn_at is null
      and (p_notice_hash is null or p.notice_hash=p_notice_hash));
$$;
create function public.grant_privacy_authorization(p_user_id uuid,p_version text,p_notice_hash text,p_notice_text text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_version is distinct from 'mail061-v1' or p_notice_hash is null or p_notice_text is null
    or octet_length(p_notice_text) not between 100 and 30000
    or p_notice_hash is distinct from encode(extensions.digest(p_notice_text,'sha256'),'hex')
    or (p_notice_text::jsonb)->>'version' is distinct from p_version
    or jsonb_typeof((p_notice_text::jsonb)->'identity') is distinct from 'object'
    then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  if public.privacy_authorization_valid(p_user_id,p_notice_hash) then return true; end if;
  -- A changed notice invalidates pending OAuth and all previous optional permissions.
  perform public.stop_account_work(p_user_id,'ACCOUNT_DISCONNECTED');
  update public.gmail_accounts set status='PAUSED' where user_id=p_user_id and status='CONNECTED';
  insert into public.privacy_authorizations(user_id,notice_version,notice_hash,notice_text)
    values(p_user_id,p_version,p_notice_hash,p_notice_text)
    on conflict(user_id) do update set notice_version=excluded.notice_version,notice_hash=excluded.notice_hash,
      notice_text=excluded.notice_text,accepted_at=clock_timestamp(),withdrawn_at=null;
  insert into public.privacy_events(user_id,action,notice_version,notice_hash,notice_text)
    values(p_user_id,'GRANTED',p_version,p_notice_hash,p_notice_text);
  return true;
end;
$$;
create function public.withdraw_privacy_authorization(p_user_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare consent public.privacy_authorizations%rowtype;
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  update public.privacy_authorizations set withdrawn_at=clock_timestamp() where user_id=p_user_id and withdrawn_at is null returning * into consent;
  if found then
    insert into public.privacy_events(user_id,action,notice_version,notice_hash,notice_text)
      values(p_user_id,'WITHDRAWN',consent.notice_version,consent.notice_hash,consent.notice_text);
  end if;
  update public.gmail_accounts set status='PAUSED',credential_version=gen_random_uuid(),encrypted_access_token=null,
    access_token_expires_at=null,token_lease_id=null,token_lease_expires_at=null where user_id=p_user_id and status in ('CONNECTED','PAUSED');
  perform public.stop_account_work(p_user_id,'ACCOUNT_DISCONNECTED');
  delete from public.generation_content_authorizations where user_id=p_user_id;
  update public.style_learning_settings set auto_remove_salutations=false,authorized_at=null,revision=gen_random_uuid() where user_id=p_user_id;
  return true;
end;
$$;
create or replace function public.gmail_execution_allowed(p_user_id uuid,p_account_id uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select public.privacy_authorization_valid(p_user_id) and exists(select 1 from public.gmail_accounts a
    join public.users u on u.id=a.user_id join public.user_settings s on s.user_id=a.user_id
    where a.id=p_account_id and a.user_id=p_user_id and a.status='CONNECTED' and u.status='ACTIVE'
      and (s.automation_enabled or a.manual_processing_until>clock_timestamp()));
$$;
create function public.guard_gmail_privacy_authorization() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status='CONNECTED' and not public.privacy_authorization_valid(new.user_id) then raise exception 'PRIVACY_CONSENT_REQUIRED'; end if;
  return new;
end;
$$;
create trigger gmail_accounts_privacy_guard before insert or update of status on public.gmail_accounts
  for each row execute function public.guard_gmail_privacy_authorization();

-- Existing OAuth grants are not evidence that this disclosure was accepted.
update public.gmail_accounts set status='PAUSED' where status='CONNECTED';
do $$ declare owner_id uuid; begin
  for owner_id in select id from public.users where status='ACTIVE' loop
    perform public.stop_account_work(owner_id,'ACCOUNT_DISCONNECTED');
  end loop;
end $$;

revoke all on function public.privacy_authorization_valid(uuid,text),public.grant_privacy_authorization(uuid,text,text,text),
  public.withdraw_privacy_authorization(uuid),public.guard_gmail_privacy_authorization() from public,anon,authenticated;
grant execute on function public.privacy_authorization_valid(uuid,text),public.grant_privacy_authorization(uuid,text,text,text),
  public.withdraw_privacy_authorization(uuid),public.guard_gmail_privacy_authorization() to service_role;
