create table public.gmail_oauth_attempts (
  user_id uuid primary key references public.users (id) on delete cascade,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  code_verifier text not null check (code_verifier ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null
);

create index gmail_oauth_attempts_session_idx on public.gmail_oauth_attempts (session_id);
alter table public.gmail_oauth_attempts enable row level security;
revoke all on public.gmail_oauth_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.gmail_oauth_attempts to service_role;
