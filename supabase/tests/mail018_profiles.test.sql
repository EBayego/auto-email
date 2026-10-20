begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000181', 'authenticated', 'authenticated', 'mail018-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000182', 'authenticated', 'authenticated', 'mail018-b@example.invalid');
insert into public.gmail_accounts (id, user_id, email, status, encrypted_refresh_token, scope_set) values
  ('10000000-0000-4000-8000-000000000181', '00000000-0000-4000-8000-000000000181', 'mail018-a@example.invalid', 'CONNECTED', '\x74657374', array['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']),
  ('10000000-0000-4000-8000-000000000182', '00000000-0000-4000-8000-000000000182', 'mail018-b@example.invalid', 'CONNECTED', '\x74657374', array['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']);
insert into public.style_profiles (user_id, gmail_account_id, profile, model, prompt_version, sample_size, input_tokens, output_tokens) values
  ('00000000-0000-4000-8000-000000000181', '10000000-0000-4000-8000-000000000181', '{"schema_version":1,"language":"es","formality":"medium","average_length":"short","preferred_greetings":[],"preferred_closings":[],"vocabulary":[],"structure":"Párrafos breves.","punctuation":"Convencional.","uses_emojis":false,"style_description":"Directo y cordial."}', 'test-model', 'mail018-v1', 12, 10, 10),
  ('00000000-0000-4000-8000-000000000182', '10000000-0000-4000-8000-000000000182', '{"schema_version":1,"language":"es","formality":"medium","average_length":"short","preferred_greetings":[],"preferred_closings":[],"vocabulary":[],"structure":"Párrafos breves.","punctuation":"Convencional.","uses_emojis":false,"style_description":"Directo y cordial."}', 'test-model', 'mail018-v1', 12, 10, 10);

grant usage on schema extensions to authenticated, anon;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000181","role":"authenticated"}';
select is((select count(*) from public.style_profiles), 1::bigint, 'A solo lee su perfil sin filtros del cliente');
select is((select count(*) from public.style_profiles where user_id='00000000-0000-4000-8000-000000000182'), 0::bigint, 'No se lee el perfil de B conociendo su ID');
select throws_ok('update public.style_profiles set review_status=''CONFIRMED'', reviewed_at=now()', '42501', null::text, 'El navegador no confirma ni altera perfiles');
select throws_ok('delete from public.style_profiles', '42501', null::text, 'El navegador no borra perfiles');
reset role;

update public.gmail_accounts set status='DISCONNECTED' where user_id='00000000-0000-4000-8000-000000000181';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000181","role":"authenticated"}';
select is((select count(*) from public.style_profiles), 0::bigint, 'Desconectar impide reutilizar el perfil');
reset role;
update public.gmail_accounts set status='CONNECTED' where user_id='00000000-0000-4000-8000-000000000181';
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000181';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000181","role":"authenticated"}';
select is((select count(*) from public.style_profiles), 0::bigint, 'Una cuenta deshabilitada no lee perfiles');
reset role;
set local role anon;
select throws_ok('select * from public.style_profiles', '42501', null::text, 'Anon no lee perfiles');
reset role;

set local role service_role;
select throws_ok($q$update public.style_profiles set user_id='00000000-0000-4000-8000-000000000181' where user_id='00000000-0000-4000-8000-000000000182'$q$, '23514', null::text, 'El perfil no cambia de propietario ni desde el servicio');
select throws_ok('update public.style_profiles set sample_size=0', '23514', null::text, 'No se guarda un perfil sin muestras');
select throws_ok('update public.style_profiles set profile=''[]''::jsonb', '23514', null::text, 'El perfil debe ser un objeto JSON');
select throws_ok('update public.style_profiles set review_status=''CONFIRMED''', '23514', null::text, 'Una revisión confirmada tiene fecha');
select throws_ok('update public.style_profiles set warnings=array[''private-body'']', '23514', null::text, 'Las advertencias no admiten contenido libre');
reset role;

delete from auth.users where id='00000000-0000-4000-8000-000000000181';
select is((select count(*) from public.style_profiles where user_id='00000000-0000-4000-8000-000000000181'), 0::bigint, 'Borrar el usuario elimina su perfil');
select * from finish();
rollback;
