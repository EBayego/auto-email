
  create table "public"."gmail_sync_messages" (
    "user_id" uuid not null,
    "gmail_account_id" uuid not null,
    "message_id" text not null,
    "thread_id" text not null,
    "detected_at" timestamp with time zone not null default now()
      );


alter table "public"."gmail_sync_messages" enable row level security;

alter table "public"."gmail_accounts" add column "next_sync_at" timestamp with time zone not null default now();

alter table "public"."gmail_accounts" add column "sync_lease_expires_at" timestamp with time zone;

alter table "public"."gmail_accounts" add column "sync_lease_id" uuid;

alter table "public"."gmail_accounts" add column "sync_window_start_at" timestamp with time zone;

CREATE INDEX gmail_accounts_next_sync_idx ON public.gmail_accounts USING btree (next_sync_at, id) WHERE (status = 'CONNECTED'::text);

CREATE INDEX gmail_sync_messages_owner_idx ON public.gmail_sync_messages USING btree (user_id, gmail_account_id);

CREATE UNIQUE INDEX gmail_sync_messages_pkey ON public.gmail_sync_messages USING btree (gmail_account_id, message_id);

alter table "public"."gmail_sync_messages" add constraint "gmail_sync_messages_pkey" PRIMARY KEY using index "gmail_sync_messages_pkey";

alter table "public"."gmail_accounts" add constraint "gmail_accounts_sync_lease_pair" CHECK (((sync_lease_id IS NULL) = (sync_lease_expires_at IS NULL))) not valid;

alter table "public"."gmail_accounts" validate constraint "gmail_accounts_sync_lease_pair";

alter table "public"."gmail_sync_messages" add constraint "gmail_sync_messages_gmail_account_id_user_id_fkey" FOREIGN KEY (gmail_account_id, user_id) REFERENCES public.gmail_accounts(id, user_id) ON DELETE CASCADE not valid;

alter table "public"."gmail_sync_messages" validate constraint "gmail_sync_messages_gmail_account_id_user_id_fkey";

alter table "public"."gmail_sync_messages" add constraint "gmail_sync_messages_message_id_check" CHECK ((((char_length(message_id) >= 1) AND (char_length(message_id) <= 512)) AND (message_id ~ '^[A-Za-z0-9_-]+$'::text))) not valid;

alter table "public"."gmail_sync_messages" validate constraint "gmail_sync_messages_message_id_check";

alter table "public"."gmail_sync_messages" add constraint "gmail_sync_messages_thread_id_check" CHECK ((((char_length(thread_id) >= 1) AND (char_length(thread_id) <= 512)) AND (thread_id ~ '^[A-Za-z0-9_-]+$'::text))) not valid;

alter table "public"."gmail_sync_messages" validate constraint "gmail_sync_messages_thread_id_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.claim_gmail_sync(p_lease_seconds integer, p_overlap_seconds integer, p_initial_lookback_seconds integer)
 RETURNS TABLE(user_id uuid, gmail_account_id uuid, run_id uuid, window_start_at timestamp with time zone, window_end_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  account public.gmail_accounts%rowtype;
  run public.processing_runs%rowtype;
  since_at timestamptz;
  claimed_at timestamptz := clock_timestamp();
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600
    or p_overlap_seconds is null or p_overlap_seconds not between 1 and 86400
    or p_initial_lookback_seconds is null or p_initial_lookback_seconds not between 60 and 7776000 then
    raise exception 'INVALID_SYNC_CONFIGURATION';
  end if;

  select a.* into account from public.gmail_accounts a
    join public.users u on u.id = a.user_id
    join public.user_settings s on s.user_id = a.user_id
    where a.status = 'CONNECTED' and u.status = 'ACTIVE' and s.automation_enabled
      and a.next_sync_at <= claimed_at
      and (a.sync_lease_expires_at is null or a.sync_lease_expires_at <= claimed_at)
    order by a.next_sync_at, a.id limit 1 for update of a skip locked;
  if not found then return; end if;

  if account.sync_lease_id is not null then
    update public.processing_runs r set status = 'FAILED',
      finished_at = greatest(claimed_at, r.started_at), error_count = 1,
      error_code = 'SYNC_INTERRUPTED'
      where r.id = account.sync_lease_id and r.user_id = account.user_id
        and r.gmail_account_id = account.id and r.status = 'RUNNING';
  end if;
  since_at := coalesce(account.sync_window_start_at,
    account.last_sync_at - make_interval(secs => p_overlap_seconds),
    claimed_at - make_interval(secs => p_initial_lookback_seconds));
  insert into public.processing_runs (user_id, gmail_account_id, trigger_kind, started_at)
    values (account.user_id, account.id,
      case when account.sync_window_start_at is null then 'SCHEDULED' else 'RETRY' end,
      claimed_at) returning * into run;
  update public.gmail_accounts a set sync_lease_id = run.id,
    sync_lease_expires_at = claimed_at + make_interval(secs => p_lease_seconds),
    sync_window_start_at = since_at where a.id = account.id and a.user_id = account.user_id;
  return query select account.user_id, account.id, run.id, since_at, claimed_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_gmail_sync(p_user_id uuid, p_account_id uuid, p_run_id uuid, p_success boolean, p_error_code text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  account public.gmail_accounts%rowtype;
  completed_at timestamptz;
  poll_seconds integer;
begin
  if p_success is null or (not p_success and p_error_code is null)
    or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$') then
    raise exception 'INVALID_SYNC_OUTCOME';
  end if;
  select a.* into account from public.gmail_accounts a
    where a.id = p_account_id and a.user_id = p_user_id and a.sync_lease_id = p_run_id
      and a.sync_lease_expires_at > clock_timestamp() for update;
  if not found then return false; end if;
  select s.poll_interval_seconds into poll_seconds from public.user_settings s
    where s.user_id = p_user_id;
  if p_success and (account.status <> 'CONNECTED'
    or not exists (select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
    or not exists (select 1 from public.user_settings s where s.user_id = p_user_id and s.automation_enabled)) then
    raise exception 'SYNC_NOT_ACTIVE';
  end if;
  update public.processing_runs r set status = case when p_success then 'COMPLETED' else 'FAILED' end,
    finished_at = greatest(clock_timestamp(), r.started_at),
    error_count = case when p_success then 0 else 1 end,
    error_code = case when p_success then null else p_error_code end
    where r.id = p_run_id and r.user_id = p_user_id
      and r.gmail_account_id = p_account_id and r.status = 'RUNNING'
    returning r.started_at into completed_at;
  if not found then return false; end if;
  update public.gmail_accounts a set
    last_sync_at = case when p_success then completed_at else a.last_sync_at end,
    sync_window_start_at = case when p_success then null else a.sync_window_start_at end,
    sync_lease_id = null, sync_lease_expires_at = null,
    next_sync_at = clock_timestamp() + make_interval(secs => coalesce(poll_seconds, 300))
    where a.id = p_account_id and a.user_id = p_user_id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_gmail_sync_page(p_user_id uuid, p_account_id uuid, p_run_id uuid, p_messages jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  added integer;
begin
  perform 1 from public.gmail_accounts a
    where a.id = p_account_id and a.user_id = p_user_id and a.sync_lease_id = p_run_id
      and a.sync_lease_expires_at > clock_timestamp() and a.status = 'CONNECTED'
      and exists (select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and exists (select 1 from public.user_settings s where s.user_id = p_user_id and s.automation_enabled)
    for update;
  if not found then raise exception 'SYNC_LEASE_LOST'; end if;
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'INVALID_SYNC_MESSAGES';
  end if;
  if jsonb_array_length(p_messages) > 100 or exists (
    select 1 from jsonb_array_elements(p_messages) m
    where jsonb_typeof(m) <> 'object' or m - 'id' - 'threadId' <> '{}'::jsonb
      or jsonb_typeof(m->'id') is distinct from 'string'
      or jsonb_typeof(m->'threadId') is distinct from 'string'
      or char_length(coalesce(m->>'id', '')) not between 1 and 512
      or char_length(coalesce(m->>'threadId', '')) not between 1 and 512
      or coalesce(m->>'id', '') !~ '^[A-Za-z0-9_-]+$'
      or coalesce(m->>'threadId', '') !~ '^[A-Za-z0-9_-]+$'
  ) then raise exception 'INVALID_SYNC_MESSAGES'; end if;
  insert into public.gmail_sync_messages (user_id, gmail_account_id, message_id, thread_id)
    select p_user_id, p_account_id, m->>'id', m->>'threadId'
      from jsonb_array_elements(p_messages) m
    on conflict (gmail_account_id, message_id) do nothing;
  get diagnostics added = row_count;
  update public.processing_runs r set messages_detected = r.messages_detected + added
    where r.id = p_run_id and r.user_id = p_user_id
      and r.gmail_account_id = p_account_id and r.status = 'RUNNING';
  if not found then raise exception 'SYNC_LEASE_LOST'; end if;
  return added;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.renew_gmail_sync(p_user_id uuid, p_account_id uuid, p_run_id uuid, p_lease_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'INVALID_SYNC_CONFIGURATION';
  end if;
  update public.gmail_accounts a
    set sync_lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where a.id = p_account_id and a.user_id = p_user_id and a.sync_lease_id = p_run_id
      and a.sync_lease_expires_at > clock_timestamp() and a.status = 'CONNECTED'
      and exists (select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and exists (select 1 from public.user_settings s where s.user_id = p_user_id and s.automation_enabled);
  return found;
end;
$function$
;

grant delete on table "public"."gmail_sync_messages" to "service_role";

grant insert on table "public"."gmail_sync_messages" to "service_role";

grant references on table "public"."gmail_sync_messages" to "service_role";

grant select on table "public"."gmail_sync_messages" to "service_role";

grant trigger on table "public"."gmail_sync_messages" to "service_role";

grant truncate on table "public"."gmail_sync_messages" to "service_role";

grant update on table "public"."gmail_sync_messages" to "service_role";


  create policy "gmail_sync_messages_select_own"
  on "public"."gmail_sync_messages"
  as permissive
  for select
  to authenticated
using ((( SELECT auth.uid() AS uid) = user_id));

revoke all on table public.gmail_sync_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.gmail_sync_messages to service_role;
revoke all on function public.claim_gmail_sync(integer, integer, integer),
  public.renew_gmail_sync(uuid, uuid, uuid, integer),
  public.record_gmail_sync_page(uuid, uuid, uuid, jsonb),
  public.finish_gmail_sync(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_gmail_sync(integer, integer, integer),
  public.renew_gmail_sync(uuid, uuid, uuid, integer),
  public.record_gmail_sync_page(uuid, uuid, uuid, jsonb),
  public.finish_gmail_sync(uuid, uuid, uuid, boolean, text) to service_role;



