begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000081', 'authenticated', 'authenticated', 'mail008-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000082', 'authenticated', 'authenticated', 'mail008-b@example.invalid');
insert into public.gmail_accounts (id, user_id, email, encrypted_refresh_token) values
  ('10000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000081', 'mail008-a@example.invalid', '\x74657374'),
  ('10000000-0000-4000-8000-000000000082', '00000000-0000-4000-8000-000000000082', 'mail008-b@example.invalid', '\x74657374');
insert into public.processing_runs (id, user_id, gmail_account_id) values
  ('20000000-0000-4000-8000-000000000081', '00000000-0000-4000-8000-000000000081', '10000000-0000-4000-8000-000000000081'),
  ('20000000-0000-4000-8000-000000000082', '00000000-0000-4000-8000-000000000082', '10000000-0000-4000-8000-000000000082');

grant usage on schema extensions to authenticated, anon;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000081","role":"authenticated"}';
select is((select count(id) from public.gmail_accounts), 1::bigint, 'A solo lee su cuenta con los permisos definitivos');
select is((select count(id) from public.processing_runs), 1::bigint, 'A solo lee sus ejecuciones sin filtros del cliente');
select is((select count(user_id) from public.user_settings), 1::bigint, 'A solo lee su configuración');
select is((select count(id) from public.gmail_accounts where id='10000000-0000-4000-8000-000000000082'), 0::bigint, 'Conocer el ID de la cuenta B no concede acceso');
select is((select count(id) from public.processing_runs where id='20000000-0000-4000-8000-000000000082'), 0::bigint, 'Conocer el ID de la ejecución B no concede acceso');
select throws_ok('select encrypted_refresh_token from public.gmail_accounts', '42501', null::text, 'Ni siquiera el propietario lee ciphertext desde el cliente');
select throws_ok('select * from public.gmail_accounts', '42501', null::text, 'Una proyección accidental amplia falla');
select throws_ok('update public.gmail_accounts set status=''PAUSED''', '42501', null::text, 'El navegador no modifica cuentas');
select throws_ok('delete from public.gmail_accounts', '42501', null::text, 'El navegador no elimina cuentas');
select throws_ok('update public.processing_runs set status=''FAILED''', '42501', null::text, 'El navegador no fabrica resultados');
select throws_ok($q$insert into public.processing_runs (user_id,gmail_account_id) values ('00000000-0000-4000-8000-000000000081','10000000-0000-4000-8000-000000000081')$q$, '42501', null::text, 'El navegador no crea trabajos');
select throws_ok('update public.user_settings set automation_enabled=true', '42501', null::text, 'No se amplían los permisos de escritura de ajustes');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000082","role":"authenticated"}';
select is((select id::text from public.gmail_accounts), '10000000-0000-4000-8000-000000000082', 'B solo recupera su cuenta');
select is((select id::text from public.processing_runs), '20000000-0000-4000-8000-000000000082', 'B solo recupera su ejecución');
set local request.jwt.claims = '{}';
select is((select count(id) from public.gmail_accounts), 0::bigint, 'Sin identidad no se leen cuentas');
select is((select count(id) from public.processing_runs), 0::bigint, 'Sin identidad no se leen ejecuciones');
reset role;

update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000081';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000081","role":"authenticated"}';
select is((select count(id) from public.gmail_accounts), 0::bigint, 'Una cuenta deshabilitada pierde acceso directo a Gmail');
select is((select count(id) from public.processing_runs), 0::bigint, 'Una cuenta deshabilitada pierde acceso directo a ejecuciones');
select is((select count(user_id) from public.user_settings), 0::bigint, 'Una cuenta deshabilitada pierde acceso directo a ajustes');
reset role;

set local role anon;
select throws_ok('select id from public.gmail_accounts', '42501', null::text, 'anon no lee cuentas');
select throws_ok('select id from public.processing_runs', '42501', null::text, 'anon no lee ejecuciones');
reset role;

set local role service_role;
select is((select count(id) from public.gmail_accounts where user_id='00000000-0000-4000-8000-000000000082'), 1::bigint, 'El servicio puede trabajar con un propietario explícito');
select throws_ok($q$insert into public.processing_runs (user_id,gmail_account_id) values ('00000000-0000-4000-8000-000000000081','10000000-0000-4000-8000-000000000082')$q$, '23503', null::text, 'Incluso el servicio respeta la FK de propietario de la cuenta');
reset role;

select * from finish();
rollback;
