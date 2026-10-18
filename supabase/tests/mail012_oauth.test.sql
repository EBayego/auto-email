begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok((select relrowsecurity from pg_class where oid='public.gmail_oauth_attempts'::regclass), 'RLS protege los intentos OAuth');
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'mail012@example.invalid');
insert into auth.sessions (id, user_id) values
  ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000012","role":"authenticated"}';
select throws_ok('select * from public.gmail_oauth_attempts', '42501', null::text, 'El navegador no puede leer verificadores PKCE, ni del propio usuario');
select throws_ok('delete from public.gmail_oauth_attempts', '42501', null::text, 'El navegador no puede consumir intentos');
select throws_ok($q$insert into public.gmail_oauth_attempts (user_id, session_id, state_hash, code_verifier, expires_at) values ('00000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000012',repeat('a',64),repeat('v',43),now()+interval '10 minutes')$q$, '42501', null::text, 'El navegador no puede crear intentos');
reset role;
set local role anon;
select throws_ok('select * from public.gmail_oauth_attempts', '42501', null::text, 'anon no puede leer intentos');
reset role;

set local role service_role;
insert into public.gmail_oauth_attempts (user_id, session_id, state_hash, code_verifier, expires_at) values
  ('00000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000012',repeat('a',64),repeat('v',43),now()+interval '10 minutes');
select is((select count(*) from public.gmail_oauth_attempts where user_id='00000000-0000-4000-8000-000000000012'), 1::bigint, 'El servicio guarda un intento vinculado a una sesión real');
select throws_ok($q$update public.gmail_oauth_attempts set state_hash='invalid'$q$, '23514', null::text, 'El estado debe ser un hash SHA256');
select throws_ok($q$update public.gmail_oauth_attempts set code_verifier='short'$q$, '23514', null::text, 'El verificador conserva entropía suficiente');
select throws_ok($q$update public.gmail_oauth_attempts set session_id='10000000-0000-4000-8000-000000000099'$q$, '23503', null::text, 'Una sesión inexistente no permite iniciar OAuth');
reset role;
delete from auth.sessions where id='10000000-0000-4000-8000-000000000012';
select is((select count(*) from public.gmail_oauth_attempts where user_id='00000000-0000-4000-8000-000000000012'), 0::bigint, 'Cerrar la sesión invalida el intento pendiente');

select * from finish();
rollback;
