create schema worker_private;
revoke all on schema worker_private from public,anon,authenticated;
grant usage on schema worker_private to service_role;
create table worker_private.provider_request_scopes (
  provider text not null check (provider in ('google','openai')),
  scope_key text not null,
  user_id uuid,
  gmail_account_id uuid,
  blocked_until timestamptz not null default '-infinity',
  primary key (provider,scope_key),
  foreign key (gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  check ((scope_key='global' and gmail_account_id is null and user_id is null)
    or (gmail_account_id is not null and user_id is not null and scope_key=gmail_account_id::text))
);
create table worker_private.provider_requests (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google','openai')),
  user_id uuid,
  gmail_account_id uuid,
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  released boolean not null default false,
  foreign key (gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  check ((user_id is null) = (gmail_account_id is null)),
  check (expires_at > started_at)
);
create index provider_requests_window_idx on worker_private.provider_requests(provider,started_at);
create index provider_request_scopes_account_idx on worker_private.provider_request_scopes(gmail_account_id,user_id);
create index provider_requests_account_idx on worker_private.provider_requests(gmail_account_id,user_id,provider,started_at);
alter table worker_private.provider_request_scopes enable row level security;
alter table worker_private.provider_requests enable row level security;
revoke all on worker_private.provider_request_scopes,worker_private.provider_requests from public,anon,authenticated;
grant select,insert,update,delete on worker_private.provider_request_scopes,worker_private.provider_requests to service_role;

create function public.acquire_provider_request(p_provider text,p_lease_seconds integer,p_max_concurrent integer,
  p_account_max_concurrent integer,p_requests_per_minute integer,p_account_requests_per_minute integer,
  p_user_id uuid default null,p_account_id uuid default null)
returns table(lease_id uuid,retry_after_ms integer) language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz; blocked timestamptz; account_blocked timestamptz; active_count integer; account_active integer;
  minute_count integer; account_count integer; oldest timestamptz; account_oldest timestamptz; wait_ms integer := 0; token uuid;
begin
  if p_provider is null or p_provider not in ('google','openai') or p_lease_seconds is null or p_lease_seconds not between 1 and 600
    or p_max_concurrent is null or p_max_concurrent not between 1 and 100
    or p_account_max_concurrent is null or p_account_max_concurrent not between 1 and 10
    or p_requests_per_minute is null or p_requests_per_minute not between 1 and 10000
    or p_account_requests_per_minute is null or p_account_requests_per_minute not between 1 and 1000
    or (p_user_id is null) <> (p_account_id is null) then raise exception 'INVALID_PROVIDER_LIMITS'; end if;
  if p_account_id is not null and not exists(select 1 from public.gmail_accounts a join public.users u on u.id=a.user_id
    where a.id=p_account_id and a.user_id=p_user_id and a.status='CONNECTED' and u.status='ACTIVE') then raise exception 'PROVIDER_ACCOUNT_NOT_ACTIVE'; end if;
  insert into worker_private.provider_request_scopes(provider,scope_key) values(p_provider,'global') on conflict do nothing;
  select s.blocked_until into blocked from worker_private.provider_request_scopes s where s.provider=p_provider and s.scope_key='global' for update;
  stamp := clock_timestamp();
  if p_account_id is not null then
    insert into worker_private.provider_request_scopes(provider,scope_key,user_id,gmail_account_id)
      values(p_provider,p_account_id::text,p_user_id,p_account_id) on conflict do nothing;
    select s.blocked_until into account_blocked from worker_private.provider_request_scopes s where s.provider=p_provider and s.scope_key=p_account_id::text;
    blocked := greatest(blocked,account_blocked);
  end if;
  if blocked > stamp then return query select null::uuid,least(86400000,ceil(extract(epoch from blocked-stamp)*1000))::integer; return; end if;
  delete from worker_private.provider_requests r where r.provider=p_provider and r.started_at <= stamp-interval '60 seconds' and (r.released or r.expires_at <= stamp);
  select count(*) filter(where not r.released and r.expires_at>stamp),
    count(*) filter(where r.started_at>stamp-interval '60 seconds'),
    min(r.started_at) filter(where r.started_at>stamp-interval '60 seconds'),
    count(*) filter(where r.gmail_account_id=p_account_id and not r.released and r.expires_at>stamp),
    count(*) filter(where r.gmail_account_id=p_account_id and r.started_at>stamp-interval '60 seconds'),
    min(r.started_at) filter(where r.gmail_account_id=p_account_id and r.started_at>stamp-interval '60 seconds')
    into active_count,minute_count,oldest,account_active,account_count,account_oldest
    from worker_private.provider_requests r where r.provider=p_provider;
  if active_count>=p_max_concurrent or (p_account_id is not null and account_active>=p_account_max_concurrent) then wait_ms:=250; end if;
  if minute_count>=p_requests_per_minute then wait_ms:=greatest(wait_ms,ceil(extract(epoch from oldest+interval '60 seconds'-stamp)*1000)::integer); end if;
  if p_account_id is not null and account_count>=p_account_requests_per_minute then wait_ms:=greatest(wait_ms,ceil(extract(epoch from account_oldest+interval '60 seconds'-stamp)*1000)::integer); end if;
  if wait_ms>0 then return query select null::uuid,wait_ms; return; end if;
  insert into worker_private.provider_requests(provider,user_id,gmail_account_id,started_at,expires_at)
    values(p_provider,p_user_id,p_account_id,stamp,stamp+make_interval(secs=>p_lease_seconds)) returning id into token;
  return query select token,0;
end;
$$;

create function public.release_provider_request(p_lease_id uuid,p_user_id uuid default null,p_account_id uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update worker_private.provider_requests r set released=true where r.id=p_lease_id
    and r.user_id is not distinct from p_user_id and r.gmail_account_id is not distinct from p_account_id;
end;
$$;
create function public.cooldown_provider_requests(p_provider text,p_delay_ms bigint,p_user_id uuid default null,p_account_id uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare scope text := case when p_provider='google' and p_account_id is not null then p_account_id::text else 'global' end;
begin
  if p_provider is null or p_provider not in ('google','openai') or p_delay_ms is null or p_delay_ms not between 0 and 9007199254740991
    or (p_user_id is null) <> (p_account_id is null) then raise exception 'INVALID_PROVIDER_LIMITS'; end if;
  if p_account_id is not null and not exists(select 1 from public.gmail_accounts a where a.id=p_account_id and a.user_id=p_user_id) then raise exception 'PROVIDER_ACCOUNT_NOT_ACTIVE'; end if;
  insert into worker_private.provider_request_scopes(provider,scope_key,user_id,gmail_account_id,blocked_until)
    values(p_provider,scope,case when scope='global' then null else p_user_id end,case when scope='global' then null else p_account_id end,
      clock_timestamp()+make_interval(secs=>p_delay_ms::double precision/1000))
    on conflict(provider,scope_key) do update set blocked_until=greatest(worker_private.provider_request_scopes.blocked_until,excluded.blocked_until);
end;
$$;
revoke all on function public.acquire_provider_request(text,integer,integer,integer,integer,integer,uuid,uuid),
  public.release_provider_request(uuid,uuid,uuid),public.cooldown_provider_requests(text,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquire_provider_request(text,integer,integer,integer,integer,integer,uuid,uuid),
  public.release_provider_request(uuid,uuid,uuid),public.cooldown_provider_requests(text,bigint,uuid,uuid) to service_role;
