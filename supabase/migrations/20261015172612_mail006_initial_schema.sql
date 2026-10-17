-- MAIL-006: esquema inicial. No se copia contenido de Gmail ni se crean usuarios reales.

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public, anon, authenticated;

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_status_check check (status in ('ACTIVE', 'DISABLED', 'DELETION_PENDING'))
);

create table public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  email text not null,
  status text not null default 'DISCONNECTED',
  encrypted_refresh_token bytea,
  scope_set text[] not null default '{}',
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gmail_accounts_user_id_key unique (user_id),
  constraint gmail_accounts_email_key unique (email),
  constraint gmail_accounts_id_user_id_key unique (id, user_id),
  constraint gmail_accounts_email_check check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint gmail_accounts_status_check check (
    status in ('DISCONNECTED', 'CONNECTED', 'REAUTH_REQUIRED', 'PAUSED')
  ),
  constraint gmail_accounts_token_check check (
    encrypted_refresh_token is null or octet_length(encrypted_refresh_token) > 0
  ),
  constraint gmail_accounts_scopes_check check (
    coalesce(array_ndims(scope_set), 1) = 1
    and array_position(scope_set, null::text) is null
  ),
  constraint gmail_accounts_connected_check check (
    status <> 'CONNECTED' or (
      encrypted_refresh_token is not null
      and scope_set @> array[
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose'
      ]::text[]
    )
  )
);

create index gmail_accounts_sync_idx on public.gmail_accounts (status, last_sync_at);

create table public.user_settings (
  user_id uuid primary key references public.users (id) on delete cascade,
  automation_enabled boolean not null default false,
  poll_interval_seconds integer not null default 300,
  max_daily_drafts integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_poll_interval_check check (poll_interval_seconds >= 60),
  constraint user_settings_daily_limit_check check (max_daily_drafts >= 0)
);

create table public.processing_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  gmail_account_id uuid not null,
  trigger_kind text not null default 'MANUAL',
  status text not null default 'RUNNING',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  messages_detected integer not null default 0,
  messages_processed integer not null default 0,
  drafts_created integer not null default 0,
  error_count integer not null default 0,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processing_runs_account_owner_fkey
    foreign key (gmail_account_id, user_id)
    references public.gmail_accounts (id, user_id) on delete cascade,
  constraint processing_runs_trigger_check check (trigger_kind in ('MANUAL', 'SCHEDULED', 'RETRY')),
  constraint processing_runs_status_check check (status in ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  constraint processing_runs_timestamps_check check (
    (finished_at is null or finished_at >= started_at)
    and ((status = 'RUNNING' and finished_at is null) or (status <> 'RUNNING' and finished_at is not null))
  ),
  constraint processing_runs_counts_check check (
    messages_detected >= 0 and messages_processed >= 0
    and drafts_created >= 0 and error_count >= 0
    and messages_processed <= messages_detected
    and drafts_created <= messages_processed
  ),
  constraint processing_runs_error_code_check check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  constraint processing_runs_failed_check check (status <> 'FAILED' or error_code is not null)
);

create index processing_runs_user_started_idx on public.processing_runs (user_id, started_at desc);
create index processing_runs_account_owner_started_idx
  on public.processing_runs (gmail_account_id, user_id, started_at desc);

create trigger users_touch_updated_at before update on public.users
  for each row execute function public.touch_updated_at();
create trigger gmail_accounts_touch_updated_at before update on public.gmail_accounts
  for each row execute function public.touch_updated_at();
create trigger user_settings_touch_updated_at before update on public.user_settings
  for each row execute function public.touch_updated_at();
create trigger processing_runs_touch_updated_at before update on public.processing_runs
  for each row execute function public.touch_updated_at();

alter table public.users enable row level security;
alter table public.gmail_accounts enable row level security;
alter table public.user_settings enable row level security;
alter table public.processing_runs enable row level security;

-- Políticas preparadas para MAIL-008. No conceden privilegios por sí mismas.
create policy users_select_own on public.users for select to authenticated
  using ((select auth.uid()) = id);
create policy gmail_accounts_select_own on public.gmail_accounts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_settings_select_own on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy processing_runs_select_own on public.processing_runs for select to authenticated
  using ((select auth.uid()) = user_id);

-- Acceso inicial exclusivamente de servidor. MAIL-008 concederá acceso a columnas
-- concretas cuando haya sesión y repositorios. Nunca conceder SELECT * de tokens al cliente.
revoke all on table public.users, public.gmail_accounts, public.user_settings,
  public.processing_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.users, public.gmail_accounts,
  public.user_settings, public.processing_runs to service_role;

comment on table public.users is 'Identidad de aplicación vinculada a auth.users; alta funcional en MAIL-007.';
comment on table public.gmail_accounts is 'Una cuenta Gmail por usuario y un titular por buzón; sin cuerpos de correo.';
comment on column public.gmail_accounts.encrypted_refresh_token is 'Solo ciphertext; cifrado y ciclo de vida en MAIL-013. Acceso exclusivo de backend/worker.';
comment on table public.user_settings is 'Ajustes básicos por usuario. Automatización deshabilitada por defecto.';
comment on table public.processing_runs is 'Ejecuciones agregadas por cuenta. No sustituye los trabajos por mensaje de MAIL-031.';
comment on column public.processing_runs.error_code is 'Código categórico; no almacenar mensajes de error que incluyan contenido o credenciales.';
