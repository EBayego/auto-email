begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, aud, role, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-000000000071', 'authenticated', 'authenticated', 'mail007-a@example.invalid', '{"status":"DISABLED","user_id":"00000000-0000-4000-8000-000000000072"}'),
  ('00000000-0000-4000-8000-000000000072', 'authenticated', 'authenticated', 'mail007-b@example.invalid', '{}');

select is((select status from public.users where id = '00000000-0000-4000-8000-000000000071'), 'ACTIVE', 'El alta usa auth.users.id e ignora los metadatos editables');
select is((select count(*) from public.user_settings where user_id in ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000072')), 2::bigint, 'Cada identidad recibe sus ajustes');
select is((select automation_enabled from public.user_settings where user_id = '00000000-0000-4000-8000-000000000071'), false, 'La automatización empieza desactivada');
select is((select poll_interval_seconds from public.user_settings where user_id = '00000000-0000-4000-8000-000000000071'), 300, 'Se conserva el polling predeterminado');
select is((select max_daily_drafts from public.user_settings where user_id = '00000000-0000-4000-8000-000000000071'), 30, 'Se conserva el límite diario predeterminado');
select is((select count(*) from public.gmail_accounts where user_id = '00000000-0000-4000-8000-000000000071'), 0::bigint, 'Registrarse no conecta una cuenta Gmail');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'El cliente no accede al esquema de aprovisionamiento');
select ok(not has_function_privilege('authenticated', 'private.provision_app_user()', 'execute'), 'La función privilegiada no se expone como RPC');
select ok(not has_function_privilege('anon', 'private.provision_app_user()', 'execute'), 'anon no ejecuta el aprovisionamiento');

insert into auth.users (id, aud, role, is_anonymous)
values ('00000000-0000-4000-8000-000000000073', 'authenticated', 'authenticated', true);
select is((select count(*) from public.users where id = '00000000-0000-4000-8000-000000000073'), 0::bigint, 'Las identidades anónimas no reciben una cuenta de aplicación');

grant usage on schema extensions to authenticated, anon;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000071","role":"authenticated"}';
select is((select count(id) from public.users), 1::bigint, 'A solo puede leer su identidad con los permisos reales');
select is((select count(user_id) from public.user_settings), 1::bigint, 'A solo puede leer sus ajustes con los permisos reales');
select is((select count(id) from public.users where id = '00000000-0000-4000-8000-000000000072'), 0::bigint, 'A no lee la identidad de B');
select is((select count(user_id) from public.user_settings where user_id = '00000000-0000-4000-8000-000000000072'), 0::bigint, 'A no lee los ajustes de B');
select throws_ok('update public.users set status = ''ACTIVE''', '42501', null::text, 'El usuario no puede cambiar su estado');
select throws_ok('insert into public.users (id) values (auth.uid())', '42501', null::text, 'El usuario no fabrica identidades');
select throws_ok('delete from public.users', '42501', null::text, 'El cliente no borra identidades');
select throws_ok('update public.user_settings set automation_enabled = true', '42501', null::text, 'El cliente no activa automatización');
select throws_ok('select encrypted_refresh_token from public.gmail_accounts', '42501', null::text, 'No se concedió acceso a tokens Gmail');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000072","role":"authenticated"}';
select is((select id::text from public.users), '00000000-0000-4000-8000-000000000072', 'B recibe únicamente su identidad');
select is((select user_id::text from public.user_settings), '00000000-0000-4000-8000-000000000072', 'B recibe únicamente sus ajustes');
set local request.jwt.claims = '{}';
select is((select count(id) from public.users), 0::bigint, 'Sin identidad verificada no se lee ningún perfil');
select is((select count(user_id) from public.user_settings), 0::bigint, 'Sin identidad verificada no se leen ajustes');
reset role;

set local role anon;
select throws_ok('select id from public.users', '42501', null::text, 'anon no lee identidades');
select throws_ok('select user_id from public.user_settings', '42501', null::text, 'anon no lee ajustes');
reset role;

delete from auth.users where id = '00000000-0000-4000-8000-000000000071';
select is((select count(*) from public.user_settings where user_id = '00000000-0000-4000-8000-000000000071'), 0::bigint, 'La baja elimina los ajustes aprovisionados');
select is((select count(*) from public.users where id = '00000000-0000-4000-8000-000000000072'), 1::bigint, 'La baja de A conserva a B');

select * from finish();
rollback;
