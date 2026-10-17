-- Exclusivamente datos sintéticos de validación local. No aplicar al proyecto remoto.
-- Las cuentas no contienen contraseñas ni identidades de acceso utilizables.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'mail006-owner-a@example.invalid', '{}', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'mail006-owner-b@example.invalid', '{}', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
on conflict (id) do nothing;

insert into public.users (id)
values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

insert into public.user_settings (user_id)
select id from public.users where id in (
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'
)
on conflict (user_id) do nothing;

insert into public.gmail_accounts (id, user_id, email)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'mail006-owner-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'mail006-owner-b@example.invalid')
on conflict (id) do nothing;

insert into public.processing_runs (
  id, user_id, gmail_account_id, status, started_at, finished_at,
  messages_detected, messages_processed, drafts_created
)
values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'COMPLETED', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 2, 1, 1),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', 'COMPLETED', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1, 1, 0)
on conflict (id) do nothing;
