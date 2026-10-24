begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(not has_function_privilege('anon', 'public.claim_gmail_sync(integer,integer,integer)', 'EXECUTE'), 'Anon no reclama cuentas');
select ok(not has_function_privilege('authenticated', 'public.claim_gmail_sync(integer,integer,integer)', 'EXECUTE'), 'El navegador no reclama cuentas');
select ok(has_function_privilege('service_role', 'public.claim_gmail_sync(integer,integer,integer)', 'EXECUTE'), 'El worker puede reclamar cuentas');
select ok(not has_function_privilege('authenticated', 'public.record_gmail_sync_page(uuid,uuid,uuid,jsonb)', 'EXECUTE'), 'El navegador no registra mensajes');
select ok(not has_function_privilege('anon', 'public.renew_gmail_sync(uuid,uuid,uuid,integer)', 'EXECUTE'), 'Anon no renueva leases');
select ok(not has_function_privilege('authenticated', 'public.finish_gmail_sync(uuid,uuid,uuid,boolean,text)', 'EXECUTE'), 'El navegador no confirma sincronizaciones');
select ok((select relrowsecurity from pg_class where oid = 'public.gmail_sync_messages'::regclass), 'Registro con RLS');
select ok(not has_table_privilege('authenticated', 'public.gmail_sync_messages', 'SELECT,INSERT,UPDATE,DELETE'), 'Registro exclusivo del backend');

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000029', 'authenticated', 'authenticated', 'mail029@example.invalid'),
  ('00000000-0000-4000-8000-000000000129', 'authenticated', 'authenticated', 'mail029-other@example.invalid');
insert into public.gmail_accounts (id, user_id, email, status, encrypted_refresh_token, scope_set) values
  ('00000000-0000-4000-8000-000000000229', '00000000-0000-4000-8000-000000000029', 'mail029@example.invalid',
   'CONNECTED', '\x0102', array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
update public.user_settings set automation_enabled = false;
select is((select count(*) from public.claim_gmail_sync(300,300,86400)), 0::bigint, 'No sincroniza sin consentimiento');
select throws_ok('select * from public.claim_gmail_sync(0,300,86400)', 'P0001', 'INVALID_SYNC_CONFIGURATION', 'Valida duración del lease');
select throws_ok('select * from public.claim_gmail_sync(300,0,86400)', 'P0001', 'INVALID_SYNC_CONFIGURATION', 'Exige solapamiento');
update public.user_settings set automation_enabled = true where user_id = '00000000-0000-4000-8000-000000000029';
update public.gmail_accounts set status = 'PAUSED' where id = '00000000-0000-4000-8000-000000000229';
select is((select count(*) from public.claim_gmail_sync(300,300,86400)), 0::bigint, 'No reclama cuentas pausadas');
update public.gmail_accounts set status = 'CONNECTED' where id = '00000000-0000-4000-8000-000000000229';
update public.users set status = 'DISABLED' where id = '00000000-0000-4000-8000-000000000029';
select is((select count(*) from public.claim_gmail_sync(300,300,86400)), 0::bigint, 'No reclama usuarios deshabilitados');
update public.users set status = 'ACTIVE' where id = '00000000-0000-4000-8000-000000000029';
create temporary table first_claim as select * from public.claim_gmail_sync(300,300,86400);
select is((select count(*) from first_claim), 1::bigint, 'Reclama una cuenta conectada');
select is((select count(*) from public.claim_gmail_sync(300,300,86400)), 0::bigint, 'No permite dos ejecuciones simultáneas');
select is((select last_sync_at from public.gmail_accounts where id = '00000000-0000-4000-8000-000000000229'), null::timestamptz, 'Reclamar no adelanta el cursor');
select is((select public.record_gmail_sync_page(user_id, gmail_account_id, run_id,
  '[{"id":"m1","threadId":"t1"},{"id":"m1","threadId":"t1"}]') from first_claim), 1, 'Deduplica incluso en la misma página');
select is((select public.record_gmail_sync_page(user_id, gmail_account_id, run_id,
  '[{"id":"m1","threadId":"t1"}]') from first_claim), 0, 'Deduplica páginas repetidas');
select throws_ok($q$select public.record_gmail_sync_page(user_id,gmail_account_id,run_id,
  '[{"id":"m2","threadId":"t2","body":"private"}]') from first_claim$q$,
  'P0001','INVALID_SYNC_MESSAGES','No acepta contenido de correo');
select throws_ok($q$select public.record_gmail_sync_page('00000000-0000-4000-8000-000000000129',gmail_account_id,run_id,
  '[{"id":"m2","threadId":"t2"}]') from first_claim$q$, 'P0001','SYNC_LEASE_LOST','Valida propietario del mensaje');
select is((select messages_detected from public.processing_runs where id = (select run_id from first_claim)), 1, 'Contador solo de mensajes nuevos');
select ok((select public.finish_gmail_sync(user_id,gmail_account_id,run_id,false,'SYNC_UNAVAILABLE') from first_claim), 'Registra fallo');
select is((select last_sync_at from public.gmail_accounts where id = '00000000-0000-4000-8000-000000000229'), null::timestamptz, 'Fallo mantiene cursor');
update public.gmail_accounts set next_sync_at = now() - interval '1 second' where id = '00000000-0000-4000-8000-000000000229';
create temporary table retry_claim as select * from public.claim_gmail_sync(300,300,86400);
select is((select window_start_at from retry_claim), (select window_start_at from first_claim), 'Reintento conserva ventana inicial');
select is((select trigger_kind from public.processing_runs where id = (select run_id from retry_claim)), 'RETRY', 'Reconciliación identificada');
select ok((select public.finish_gmail_sync(user_id,gmail_account_id,run_id,true) from retry_claim), 'Confirma ventana completa');
select is((select last_sync_at from public.gmail_accounts where id = '00000000-0000-4000-8000-000000000229'), (select window_end_at from retry_claim), 'Cursor en el inicio de la consulta, sin saltar llegadas durante el polling');
select is((select count(*) from public.claim_gmail_sync(300,300,86400)), 0::bigint, 'Respeta intervalo por cuenta');
update public.gmail_accounts set next_sync_at = now() - interval '1 second' where id = '00000000-0000-4000-8000-000000000229';
create temporary table next_claim as select * from public.claim_gmail_sync(300,300,86400);
select is((select window_start_at from next_claim), (select window_end_at - interval '300 seconds' from retry_claim), 'Solapa ventanas');
update public.gmail_accounts set sync_lease_expires_at = now() - interval '1 second' where id = '00000000-0000-4000-8000-000000000229';
create temporary table recovered_claim as select * from public.claim_gmail_sync(300,300,86400);
select is((select error_code from public.processing_runs where id = (select run_id from next_claim)), 'SYNC_INTERRUPTED', 'Reconcilia ejecuciones interrumpidas');
select ok(not (select public.renew_gmail_sync(user_id,gmail_account_id,run_id,300) from next_claim), 'Un worker obsoleto no renueva el lease');
select ok(not (select public.finish_gmail_sync(user_id,gmail_account_id,run_id,true) from next_claim), 'Un worker obsoleto no confirma el cursor');
select ok((select public.finish_gmail_sync(user_id,gmail_account_id,run_id,true) from recovered_claim), 'El worker que recupera puede confirmar');
select throws_ok($q$insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id)
 values ('00000000-0000-4000-8000-000000000129','00000000-0000-4000-8000-000000000229','foreign','t1')$q$,
 '23503',null::text,'FK impide cambiar propietario');

select * from finish();
rollback;
