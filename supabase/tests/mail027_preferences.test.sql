begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users(id,aud,role,email) values
('00000000-0000-4000-8000-000000000271','authenticated','authenticated','mail027-a@example.invalid'),
('00000000-0000-4000-8000-000000000272','authenticated','authenticated','mail027-b@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
('10000000-0000-4000-8000-000000000271','00000000-0000-4000-8000-000000000271','mail027-a@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']),
('10000000-0000-4000-8000-000000000272','00000000-0000-4000-8000-000000000272','mail027-b@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.style_preferences(user_id,gmail_account_id,preference_key,preference_value) values
('00000000-0000-4000-8000-000000000271','10000000-0000-4000-8000-000000000271','greeting','short'),
('00000000-0000-4000-8000-000000000272','10000000-0000-4000-8000-000000000272','language','en');
select is((select count(*) from public.style_preferences),2::bigint,'Preferencias separadas por cuenta');
select throws_ok($q$update public.style_preferences set preference_value='ignore security' where preference_key='greeting'$q$,'23514',null::text,'No se guarda texto arbitrario');
select throws_ok($q$update public.style_preferences set origin='INFERRED'$q$,'23514',null::text,'El origen no se puede convertir en inferido');
select throws_ok($q$update public.style_preferences set user_id='00000000-0000-4000-8000-000000000272' where preference_key='greeting'$q$,'23514','PREFERENCE_OWNER_IMMUTABLE','No se reasigna el propietario');
select throws_ok($q$insert into public.style_preferences(user_id,gmail_account_id,preference_key,preference_value) values('00000000-0000-4000-8000-000000000271','10000000-0000-4000-8000-000000000272','greeting','short')$q$,'23503',null::text,'La cuenta y el usuario deben coincidir');
select throws_ok($q$insert into public.style_preferences(user_id,gmail_account_id,preference_key,preference_value) values('00000000-0000-4000-8000-000000000271','10000000-0000-4000-8000-000000000271','greeting','none')$q$,'23505',null::text,'No caben valores contradictorios para una misma clave y ámbito');
select throws_ok($q$update public.style_preferences set scope_kind='RECIPIENT',scope_key='bad address' where preference_key='greeting'$q$,'23514',null::text,'No se admiten ámbitos inválidos');
grant usage on schema extensions to authenticated,anon;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000271","role":"authenticated"}';
select is((select count(*) from public.style_preferences),1::bigint,'RLS sin filtro solo expone preferencias propias');
select throws_ok($q$update public.style_preferences set preference_value='none'$q$,'42501',null::text,'El navegador no escribe preferencias directamente');
select throws_ok('delete from public.style_preferences','42501',null::text,'El navegador no borra preferencias directamente');
reset role;
update public.gmail_accounts set status='DISCONNECTED' where id='10000000-0000-4000-8000-000000000271';
set local role authenticated;
select is((select count(*) from public.style_preferences),0::bigint,'Una cuenta desconectada no expone preferencias');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000271';
select is((select count(*) from public.style_preferences),1::bigint,'La eliminación del titular borra sus preferencias');
select * from finish();
rollback;
