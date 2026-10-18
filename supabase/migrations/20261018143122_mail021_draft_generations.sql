create table public.draft_generations (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  thread_id text not null check (thread_id ~ '^[A-Za-z0-9_-]{1,512}$'),
  target_message_id text not null check (target_message_id ~ '^[A-Za-z0-9_-]{1,512}$'),
  status text not null default 'CREATING' check (status in ('CREATING', 'CREATED', 'UNCERTAIN', 'CANCELLED')),
  draft_id text check (draft_id ~ '^[A-Za-z0-9_-]{1,512}$'),
  draft_message_id text check (draft_message_id ~ '^[A-Za-z0-9_-]{1,512}$'),
  verified_at timestamptz,
  reason_code text check (reason_code in ('THREAD_CHANGED', 'PREWRITE_FAILED', 'GMAIL_WRITE_UNCERTAIN', 'PERSISTENCE_FAILED', 'VERIFICATION_FAILED')),
  style_revision uuid not null,
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  prompt_version text not null check (prompt_version = 'mail020-v1'),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint draft_generations_account_owner_fkey foreign key (gmail_account_id, user_id)
    references public.gmail_accounts(id, user_id) on delete cascade,
  constraint draft_generations_target_key unique (gmail_account_id, target_message_id),
  constraint draft_generations_result_check check (
    (status = 'CREATED' and draft_id is not null and draft_message_id is not null and reason_code is null)
    or (status = 'CREATING' and draft_id is null and draft_message_id is null and verified_at is null and reason_code is null)
    or (status = 'UNCERTAIN' and verified_at is null and reason_code is not null)
    or (status = 'CANCELLED' and draft_id is null and draft_message_id is null and verified_at is null and reason_code is not null and reason_code in ('THREAD_CHANGED', 'PREWRITE_FAILED'))
  )
);
-- An unresolved write must be reconciled before another attempt in this thread.
create unique index draft_generations_active_thread_idx on public.draft_generations(gmail_account_id, thread_id)
  where status in ('CREATING', 'UNCERTAIN');
create index draft_generations_user_id_idx on public.draft_generations(user_id);
create index draft_generations_account_owner_idx on public.draft_generations(gmail_account_id, user_id);
alter table public.draft_generations enable row level security;
revoke all on public.draft_generations from anon, authenticated;
grant select on public.draft_generations to authenticated;
grant select, insert, update, delete on public.draft_generations to service_role;
create policy draft_generations_select_own on public.draft_generations for select to authenticated using (
  (select auth.uid()) = user_id
  and (select exists(select 1 from public.users where id = (select auth.uid()) and status = 'ACTIVE'))
  and exists(select 1 from public.gmail_accounts a where a.id = gmail_account_id and a.user_id = (select auth.uid()) and a.status = 'CONNECTED')
);
create trigger draft_generations_updated_at before update on public.draft_generations
for each row execute function public.touch_updated_at();
