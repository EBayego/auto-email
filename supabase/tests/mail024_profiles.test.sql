begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table mail024_fixture (profile jsonb);
insert into mail024_fixture values ('{"schema_version":2,"language":"es","formality":"medium","average_length":"short","preferred_greetings":["Hola"],"preferred_closings":["Gracias"],"vocabulary":[],"structure":"Párrafos breves.","punctuation":"Convencional.","uses_emojis":false,"style_description":"Directo y cordial.","form_of_address":"informal","tone":{"warmth":"warm","directness":"direct"},"structure_traits":{"sentence_length":"short","paragraph_length":"short","lists":"none"},"punctuation_traits":{"exclamations":"none","ellipses":"none","semicolons":"none"}}');
insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-000000000241', 'authenticated', 'authenticated', 'mail024-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000242', 'authenticated', 'authenticated', 'mail024-b@example.invalid');
insert into public.gmail_accounts (id, user_id, email, status, encrypted_refresh_token, scope_set) values
  ('10000000-0000-4000-8000-000000000241', '00000000-0000-4000-8000-000000000241', 'mail024-a@example.invalid', 'CONNECTED', '\x74657374', array['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']),
  ('10000000-0000-4000-8000-000000000242', '00000000-0000-4000-8000-000000000242', 'mail024-b@example.invalid', 'CONNECTED', '\x74657374', array['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']);
insert into public.style_profiles (user_id, gmail_account_id, profile, model, prompt_version, sample_size, input_tokens, output_tokens, source_message_ids, version)
select user_id, id, profile, 'test-model', 'mail024-v2', 2, 10, 10, array['sent-a', 'sent-b'], 99
from public.gmail_accounts cross join mail024_fixture where id in ('10000000-0000-4000-8000-000000000241', '10000000-0000-4000-8000-000000000242');

create temp table mail024_original as select revision, version, created_at from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241';
select is((select version from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), 1, 'La primera versión la asigna la base de datos');
select is((select origin from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), 'SENT_HISTORY', 'Se registra el origen del perfil');
select is((select source_message_ids from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), array['sent-a','sent-b'], 'Se guardan las referencias de la muestra');
select throws_ok('update public.style_profiles set source_message_ids=array[''sent-a'']', '23514', null::text, 'Las referencias coinciden con el tamaño de la muestra');
select throws_ok('update public.style_profiles set source_message_ids=array[''sent-a'',''sent-a'']', '23514', null::text, 'No se admiten referencias duplicadas');
select throws_ok('update public.style_profiles set source_message_ids=array[''bad id'',''sent-b'']', '23514', null::text, 'Las referencias no contienen texto libre');
select throws_ok('update public.style_profiles set source_message_ids=array[null,''sent-b'']', '23514', null::text, 'No se admiten referencias nulas');
select throws_ok('update public.style_profiles set origin=''OTHER_ACCOUNT''', '23514', null::text, 'El origen está enumerado');
select throws_ok($q$update public.style_profiles set profile=jsonb_set(profile, '{tone,warmth}', '"private"')$q$, '23514', null::text, 'Las características lingüísticas usan enumeraciones');
select throws_ok($q$update public.style_profiles set profile=profile - 'punctuation_traits'$q$, '23514', null::text, 'El esquema completo es obligatorio');
select throws_ok($q$update public.style_profiles set profile=profile || '{"private_body":"original email"}'$q$, '23514', null::text, 'No se admiten campos ajenos al contrato');
select throws_ok($q$update public.style_profiles set profile=jsonb_set(profile, '{schema_version}', '3')$q$, '23514', null::text, 'No se admiten versiones de esquema desconocidas');
select throws_ok('update public.style_profiles set prompt_version=''mail018-v1''', '23514', null::text, 'El prompt debe corresponder al esquema generado');
select throws_ok($q$update public.style_profiles set user_id='00000000-0000-4000-8000-000000000242', gmail_account_id='10000000-0000-4000-8000-000000000242' where user_id='00000000-0000-4000-8000-000000000241'$q$, '23514', 'PROFILE_OWNER_IMMUTABLE', 'No se puede trasladar un perfil entre cuentas');

update public.style_profiles set review_status='CONFIRMED', reviewed_at=now() where user_id='00000000-0000-4000-8000-000000000241';
select is((select version from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), 1, 'Confirmar conserva la versión del contenido');
select is((select revision from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), (select revision from mail024_original), 'Confirmar conserva la revisión');
update public.style_profiles set revision=gen_random_uuid() where user_id='00000000-0000-4000-8000-000000000241';
select is((select version from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), 2, 'Regenerar incrementa la versión incluso si el estilo no cambia');
select isnt((select revision from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), (select revision from mail024_original), 'La nueva generación recibe una revisión distinta');
select is((select review_status from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), 'UNREVIEWED', 'La nueva generación requiere nueva revisión');
select is((select reviewed_at from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), null::timestamptz, 'La revisión anterior no se hereda');
select is((select created_at from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), (select created_at from mail024_original), 'La fecha de creación se conserva');
update public.style_profiles set version=999 where user_id='00000000-0000-4000-8000-000000000241';
select is((select version from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), 2, 'El cliente no puede inventar el número de versión');
update public.style_profiles set profile=jsonb_set(profile, '{tone,warmth}', '"neutral"') where user_id='00000000-0000-4000-8000-000000000241';
select is((select version from public.style_profiles where user_id='00000000-0000-4000-8000-000000000241'), 3, 'Cambiar contenido incrementa la versión aunque no se solicite otra revisión');

grant usage on schema extensions to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000241","role":"authenticated"}';
select is((select count(*) from public.style_profiles), 1::bigint, 'El usuario solo lee su perfil v2 sin filtros del cliente');
select is((select count(*) from public.style_profiles where user_id='00000000-0000-4000-8000-000000000242'), 0::bigint, 'El esquema nuevo mantiene el aislamiento entre cuentas');
select throws_ok('update public.style_profiles set version=10', '42501', null::text, 'El navegador no altera perfiles');
reset role;
select ok(not has_function_privilege('anon', 'public.version_style_profile()', 'execute'), 'Anon no ejecuta la función de versionado');
select * from finish();
rollback;
