begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,aud,role,email) values
('00000000-0000-4000-8000-000000000541','authenticated','authenticated','mail054-a@example.invalid'),
('00000000-0000-4000-8000-000000000542','authenticated','authenticated','mail054-b@example.invalid');
\ir fixtures/privacy.inc
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
('10000000-0000-4000-8000-000000000541','00000000-0000-4000-8000-000000000541','mail054-a@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']),
('10000000-0000-4000-8000-000000000542','00000000-0000-4000-8000-000000000542','mail054-b@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.email_jobs(id,user_id,gmail_account_id,thread_id,target_message_id) values
('20000000-0000-4000-8000-000000000541','00000000-0000-4000-8000-000000000541','10000000-0000-4000-8000-000000000541','thread54a','message54a'),
('20000000-0000-4000-8000-000000000542','00000000-0000-4000-8000-000000000542','10000000-0000-4000-8000-000000000542','private54b','private54b');
select is(jsonb_array_length(public.get_activity_feed('00000000-0000-4000-8000-000000000541')->'jobs'),1,'El panel solo muestra los mensajes del titular');
select is(public.get_activity_feed('00000000-0000-4000-8000-000000000541')->'counts'->>'PENDING','1','Los contadores corresponden al titular');
select is(public.get_activity_detail('00000000-0000-4000-8000-000000000541','20000000-0000-4000-8000-000000000542'),null::jsonb,'Un identificador ajeno no devuelve detalle');
select is(public.activity_job_summary('00000000-0000-4000-8000-000000000541','20000000-0000-4000-8000-000000000542'),null::jsonb,'La función auxiliar también valida el propietario');
select ok(public.get_activity_feed('00000000-0000-4000-8000-000000000541')::text not like '%private54b%','No filtra referencias ajenas');
select ok(not(public.get_activity_detail('00000000-0000-4000-8000-000000000541','20000000-0000-4000-8000-000000000541')->'job' ? 'user_id'),'No devuelve campos internos de usuario');
select is(jsonb_array_length(public.get_activity_detail('00000000-0000-4000-8000-000000000541','20000000-0000-4000-8000-000000000541')->'events'),1,'Se muestra la detección inicial del mensaje');
select is(jsonb_array_length(public.get_activity_feed('00000000-0000-4000-8000-000000000541','FAILED')->'jobs'),0,'El filtro por estado se aplica en la consulta');
select throws_ok($q$select public.get_activity_feed('00000000-0000-4000-8000-000000000541','unknown')$q$,'P0001','INVALID_INPUT','No se aceptan estados arbitrarios');
select throws_ok($q$select public.get_activity_feed('00000000-0000-4000-8000-000000000541','ALL',now(),null)$q$,'P0001','INVALID_INPUT','El cursor requiere fecha e identificador');
select throws_ok($q$select public.get_activity_feed('00000000-0000-4000-8000-000000000541','ALL',null,null,100)$q$,'P0001','INVALID_INPUT','La página tiene un límite acotado');
insert into public.email_jobs(user_id,gmail_account_id,thread_id,target_message_id,created_at)
select '00000000-0000-4000-8000-000000000541','10000000-0000-4000-8000-000000000541','thread54_'||n,'message54_'||n,'2026-10-01T00:00:00.123456Z' from generate_series(1,25) n;
create temporary table activity_first as select public.get_activity_feed('00000000-0000-4000-8000-000000000541') value;
select is(jsonb_array_length((select value->'jobs' from activity_first)),21,'Se consulta un elemento extra para determinar si hay siguiente página');
create temporary table activity_next as select public.get_activity_feed('00000000-0000-4000-8000-000000000541','ALL',(select (value->'jobs'->19->>'createdAt')::timestamptz from activity_first),(select (value->'jobs'->19->>'id')::uuid from activity_first)) value;
select is(jsonb_array_length((select value->'jobs' from activity_next)),6,'La página siguiente conserva el desempate por UUID y la precisión temporal');
select is((select count(*) from jsonb_array_elements((select value->'jobs' from activity_first)) with ordinality a(item,pos),jsonb_array_elements((select value->'jobs' from activity_next)) b(item) where a.pos<=20 and a.item->>'id'=b.item->>'id'),0::bigint,'No hay duplicados entre páginas con fechas iguales');
update public.gmail_accounts set status='PAUSED' where user_id='00000000-0000-4000-8000-000000000541';
select is(public.get_activity_feed('00000000-0000-4000-8000-000000000541')->'overview'->>'accountStatus','PAUSED','La actividad propia sigue visible tras pausar Gmail');
select ok(not has_function_privilege('authenticated','public.get_activity_detail(uuid,uuid)','EXECUTE'),'La consulta privilegiada no se expone al navegador');
select ok(not has_function_privilege('anon','public.get_activity_feed(uuid,text,timestamptz,uuid,integer)','EXECUTE'),'Una sesión anónima no consulta el panel');
select ok(not has_function_privilege('authenticated','public.activity_job_summary(uuid,uuid)','EXECUTE'),'La función auxiliar no se expone a usuarios');
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000541';
select throws_ok($q$select public.get_activity_feed('00000000-0000-4000-8000-000000000541')$q$,'P0001','FORBIDDEN','Una identidad deshabilitada no puede leer actividad');
select * from finish();
rollback;
