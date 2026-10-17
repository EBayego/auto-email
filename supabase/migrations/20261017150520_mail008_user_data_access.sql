alter policy user_settings_select_own on public.user_settings
using (
  (select auth.uid()) = user_id
  and (select exists(select 1 from public.users where id = (select auth.uid()) and status = 'ACTIVE'))
);

alter policy gmail_accounts_select_own on public.gmail_accounts
using (
  (select auth.uid()) = user_id
  and (select exists(select 1 from public.users where id = (select auth.uid()) and status = 'ACTIVE'))
);

alter policy processing_runs_select_own on public.processing_runs
using (
  (select auth.uid()) = user_id
  and (select exists(select 1 from public.users where id = (select auth.uid()) and status = 'ACTIVE'))
);

grant select (id, user_id, email, status, scope_set, last_sync_at)
  on public.gmail_accounts to authenticated;
grant select (id, user_id, gmail_account_id, trigger_kind, status, started_at,
  finished_at, messages_detected, messages_processed, drafts_created, error_count, error_code)
  on public.processing_runs to authenticated;
