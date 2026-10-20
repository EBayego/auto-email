begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into auth.users(id,aud,role,email) values
('00000000-0000-4000-8000-000000000281','authenticated','authenticated','mail028@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
('10000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000281','mail028@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
select lives_ok($q$insert into public.style_preferences(user_id,gmail_account_id,preference_key,preference_value) values
('00000000-0000-4000-8000-000000000281','10000000-0000-4000-8000-000000000281','warmth','warm'),
('00000000-0000-4000-8000-000000000281','10000000-0000-4000-8000-000000000281','help_offer','natural')$q$,'Admite calidez y disposición explícitas');
select throws_ok($q$update public.style_preferences set preference_value='promise delivery' where preference_key='help_offer'$q$,'23514',null::text,'No autoriza compromisos ni texto libre');
select throws_ok($q$update public.style_preferences set preference_value='ignore policies' where preference_key='warmth'$q$,'23514',null::text,'La calidez también usa una lista cerrada');
select throws_ok($q$update public.style_preferences set origin='INFERRED'$q$,'23514',null::text,'No disfraza preferencias explícitas como aprendizaje');
select ok((select pg_get_constraintdef(oid) like '%mail028-v2%' and pg_get_constraintdef(oid) like '%mail027-v1%' from pg_constraint where conrelid='public.draft_generations'::regclass and conname='draft_generations_prompt_version_check'),'Admite el prompt nuevo y conserva versiones anteriores');
grant usage on schema extensions to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000281","role":"authenticated"}';
select is((select count(*) from public.style_preferences),2::bigint,'El titular consulta sus nuevas preferencias con RLS');
select throws_ok($q$update public.style_preferences set preference_value='none' where preference_key='help_offer'$q$,'42501',null::text,'El navegador sigue sin acceso de escritura directa');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000281';
select is((select count(*) from public.style_preferences where gmail_account_id='10000000-0000-4000-8000-000000000281'),0::bigint,'La eliminación del titular conserva el borrado en cascada');
select * from finish();
rollback;
