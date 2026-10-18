create table public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null unique,
  revision uuid not null default gen_random_uuid(),
  profile jsonb not null,
  model text not null check (char_length(model) between 1 and 128),
  prompt_version text not null check (prompt_version = 'mail018-v1'),
  sample_size integer not null check (sample_size between 1 and 500),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  warnings text[] not null default '{}',
  review_status text not null default 'UNREVIEWED' check (review_status in ('UNREVIEWED', 'CONFIRMED')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_profiles_account_owner_fkey foreign key (gmail_account_id, user_id)
    references public.gmail_accounts(id, user_id) on delete cascade,
  constraint style_profiles_profile_check check (
    jsonb_typeof(profile) = 'object'
    and octet_length(profile::text) <= 8192
    and profile @> '{"schema_version": 1}'::jsonb
  ),
  constraint style_profiles_warnings_check check (
    warnings <@ array['BELOW_RECOMMENDED_SIZE', 'SAMPLE_CHANGED', 'INPUT_TRUNCATED']::text[]
    and array_position(warnings, null) is null
  ),
  constraint style_profiles_review_check check (
    (review_status = 'UNREVIEWED' and reviewed_at is null)
    or (review_status = 'CONFIRMED' and reviewed_at is not null)
  )
);
create index style_profiles_user_id_idx on public.style_profiles(user_id);
alter table public.style_profiles enable row level security;
revoke all on public.style_profiles from anon, authenticated;
grant select on public.style_profiles to authenticated;
grant select, insert, update, delete on public.style_profiles to service_role;
create policy style_profiles_select_own on public.style_profiles for select to authenticated using (
  (select auth.uid()) = user_id
  and (select exists(select 1 from public.users where id = (select auth.uid()) and status = 'ACTIVE'))
  and exists(select 1 from public.gmail_accounts a where a.id = gmail_account_id and a.user_id = (select auth.uid()) and a.status = 'CONNECTED')
);
create trigger style_profiles_updated_at before update on public.style_profiles
for each row execute function public.touch_updated_at();
