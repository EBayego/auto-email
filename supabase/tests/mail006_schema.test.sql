begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'users', 'Existe la identidad de aplicación');
select has_table('public', 'gmail_accounts', 'Existen cuentas Gmail');
select has_table('public', 'user_settings', 'Existen ajustes de usuario');
select has_table('public', 'processing_runs', 'Existen ejecuciones agregadas');
select is((select count(*) from public.users), 2::bigint, 'El seed contiene dos usuarios sintéticos');
select is((select count(*) from public.gmail_accounts), 2::bigint, 'Se pueden consultar dos cuentas sintéticas');
select is((select bool_and(not automation_enabled) from public.user_settings), true, 'Automatización desactivada por defecto');
select is((select min(poll_interval_seconds) from public.user_settings), 300, 'Polling inicial de cinco minutos');
select is((select min(max_daily_drafts) from public.user_settings), 30, 'Límite inicial de treinta borradores');

insert into auth.users (id, aud, role, email)
values ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'mail006-test@example.invalid');
insert into public.users (id) values ('00000000-0000-4000-8000-000000000003');

select throws_ok($q$
  insert into public.users (id) values ('00000000-0000-4000-8000-000000000004')
$q$, '23503', null::text, 'Una identidad de aplicación requiere un usuario Auth');

select throws_ok($q$
  insert into public.gmail_accounts (user_id, email)
  values ('00000000-0000-4000-8000-000000000001', 'another@example.invalid')
$q$, '23505', null::text, 'Un usuario no puede vincular dos cuentas Gmail');

select throws_ok($q$
  insert into public.gmail_accounts (user_id, email)
  values ('00000000-0000-4000-8000-000000000003', 'mail006-owner-a@example.invalid')
$q$, '23505', null::text, 'Un buzón no puede pertenecer a dos usuarios');

select throws_ok($q$
  insert into public.gmail_accounts (user_id, email)
  values ('00000000-0000-4000-8000-000000000003', 'Upper@example.invalid')
$q$, '23514', null::text, 'La dirección debe estar normalizada para evitar duplicados por mayúsculas');

select throws_ok($q$
  update public.gmail_accounts set status = 'CONNECTED'
  where user_id = '00000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'No se marca una cuenta conectada sin token y scopes');

select throws_ok($q$
  update public.gmail_accounts set scope_set = array[null::text]
  where user_id = '00000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'No se aceptan scopes nulos');

select throws_ok($q$
  insert into public.user_settings (user_id) values ('00000000-0000-4000-8000-000000000001')
$q$, '23505', null::text, 'Hay una sola configuración por usuario');

select throws_ok($q$
  update public.user_settings set poll_interval_seconds = 0
  where user_id = '00000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'No se permite un bucle de polling de intervalo cero');

select throws_ok($q$
  update public.user_settings set max_daily_drafts = -1
  where user_id = '00000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'No se permiten límites negativos');

select throws_ok($q$
  insert into public.processing_runs (user_id, gmail_account_id)
  values ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001')
$q$, '23503', null::text, 'Una ejecución no puede atribuirse a la cuenta de otro propietario');

select throws_ok($q$
  update public.processing_runs set messages_detected = -1
  where id = '20000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'No se admiten contadores negativos');

select throws_ok($q$
  update public.processing_runs set drafts_created = 3
  where id = '20000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'Los borradores no superan los mensajes procesados');

select throws_ok($q$
  update public.processing_runs set finished_at = '2025-01-01T00:00:00Z'
  where id = '20000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'Una ejecución no puede terminar antes de empezar');

select throws_ok($q$
  update public.processing_runs set status = 'RUNNING'
  where id = '20000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'RUNNING no puede conservar una fecha de finalización');

select throws_ok($q$
  update public.processing_runs set finished_at = null
  where id = '20000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'Una ejecución finalizada tiene fecha de cierre');

select throws_ok($q$
  update public.processing_runs set status = 'FAILED'
  where id = '20000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'FAILED necesita un código de error categórico');

select throws_ok($q$
  update public.processing_runs set error_code = 'Email body or token goes here'
  where id = '20000000-0000-4000-8000-000000000001'
$q$, '23514', null::text, 'El campo de error rechaza texto libre');

update public.users set updated_at = '2000-01-01T00:00:00Z'
where id = '00000000-0000-4000-8000-000000000001';
update public.gmail_accounts set updated_at = '2000-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000001';
update public.user_settings set updated_at = '2000-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000001';
update public.processing_runs set updated_at = '2000-01-01T00:00:00Z'
where id = '20000000-0000-4000-8000-000000000001';
select ok((select updated_at > '2000-01-01T00:00:00Z' from public.users where id = '00000000-0000-4000-8000-000000000001'), 'users actualiza updated_at');
select ok((select updated_at > '2000-01-01T00:00:00Z' from public.gmail_accounts where user_id = '00000000-0000-4000-8000-000000000001'), 'gmail_accounts actualiza updated_at');
select ok((select updated_at > '2000-01-01T00:00:00Z' from public.user_settings where user_id = '00000000-0000-4000-8000-000000000001'), 'user_settings actualiza updated_at');
select ok((select updated_at > '2000-01-01T00:00:00Z' from public.processing_runs where id = '20000000-0000-4000-8000-000000000001'), 'processing_runs actualiza updated_at');

select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('users', 'gmail_accounts', 'user_settings', 'processing_runs')
  and c.relrowsecurity), 4::bigint, 'Las cuatro tablas tienen RLS activada');
select ok(not has_table_privilege('anon', 'public.users', 'select'), 'anon no puede leer identidades');
select ok(not has_table_privilege('authenticated', 'public.gmail_accounts', 'select'), 'El cliente no recibe acceso a los tokens');
select ok(not has_table_privilege('authenticated', 'public.processing_runs', 'insert'), 'El cliente no puede fabricar ejecuciones');

-- Concesión temporal solo para ejercitar las políticas; ROLLBACK la elimina.
grant select on public.users, public.gmail_accounts, public.user_settings, public.processing_runs to authenticated;
grant usage on schema extensions to authenticated, anon, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.users), 1::bigint, 'RLS deja ver solo la identidad propia');
select is((select count(*) from public.gmail_accounts), 1::bigint, 'RLS deja ver solo la cuenta propia');
select is((select count(*) from public.user_settings), 1::bigint, 'RLS deja ver solo los ajustes propios');
select is((select count(*) from public.processing_runs), 1::bigint, 'RLS deja ver solo las ejecuciones propias');
select is((select count(*) from public.gmail_accounts where user_id = '00000000-0000-4000-8000-000000000002'), 0::bigint, 'No se recupera una cuenta de otro usuario');
select throws_ok('update public.user_settings set automation_enabled = true', '42501', null::text, 'La sesión cliente no puede activar automatización');
set local request.jwt.claims = '{}';
select is((select count(*) from public.users), 0::bigint, 'Sin identidad JWT no se ven perfiles');
reset role;

set local role anon;
select throws_ok('select * from public.gmail_accounts', '42501', null::text, 'anon no puede consultar la tabla de cuentas');
reset role;

set local role service_role;
select is((select count(*) from public.users), 3::bigint, 'El backend tiene acceso explícito para gestionar identidades');
reset role;

insert into public.user_settings (user_id) values ('00000000-0000-4000-8000-000000000003');
insert into public.gmail_accounts (id, user_id, email)
values ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'mail006-test@example.invalid');
insert into public.processing_runs (user_id, gmail_account_id)
values ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003');
delete from auth.users where id = '00000000-0000-4000-8000-000000000003';
select is((select count(*) from public.users where id = '00000000-0000-4000-8000-000000000003'), 0::bigint, 'La baja Auth elimina la identidad vinculada');
select is((select count(*) from public.user_settings where user_id = '00000000-0000-4000-8000-000000000003'), 0::bigint, 'La baja elimina los ajustes propios');
select is((select count(*) from public.gmail_accounts where user_id = '00000000-0000-4000-8000-000000000003'), 0::bigint, 'La baja elimina la cuenta propia');
select is((select count(*) from public.processing_runs where user_id = '00000000-0000-4000-8000-000000000003'), 0::bigint, 'La baja elimina las ejecuciones propias');

select * from finish();
rollback;
