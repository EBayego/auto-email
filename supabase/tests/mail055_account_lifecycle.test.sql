begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,aud,role,email) values
('00000000-0000-4000-8000-000000000551','authenticated','authenticated','mail055-a@example.invalid'),
('00000000-0000-4000-8000-000000000552','authenticated','authenticated','mail055-b@example.invalid');
\ir fixtures/privacy.inc
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
('10000000-0000-4000-8000-000000000551','00000000-0000-4000-8000-000000000551','mail055-a@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']),
('10000000-0000-4000-8000-000000000552','00000000-0000-4000-8000-000000000552','mail055-b@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.email_jobs(id,user_id,gmail_account_id,thread_id,target_message_id) values
('20000000-0000-4000-8000-000000000551','00000000-0000-4000-8000-000000000551','10000000-0000-4000-8000-000000000551','t55a','m55a'),
('20000000-0000-4000-8000-000000000552','00000000-0000-4000-8000-000000000552','10000000-0000-4000-8000-000000000552','t55b','m55b');
update public.user_settings set automation_enabled=true where user_id in ('00000000-0000-4000-8000-000000000551','00000000-0000-4000-8000-000000000552');
insert into public.processing_runs(user_id,gmail_account_id) values('00000000-0000-4000-8000-000000000551','10000000-0000-4000-8000-000000000551');
update public.gmail_accounts set status='DISCONNECTED',scope_set='{}' where user_id='00000000-0000-4000-8000-000000000551';
select is((select status from public.email_jobs where id='20000000-0000-4000-8000-000000000551'),'SKIPPED','Desconectar detiene los trabajos pendientes');
select is((select reason_code from public.email_jobs where id='20000000-0000-4000-8000-000000000551'),'ACCOUNT_DISCONNECTED','La cancelación conserva un motivo categórico');
select is((select status from public.processing_runs where user_id='00000000-0000-4000-8000-000000000551'),'CANCELLED','La sincronización queda cancelada');
select is((select automation_enabled from public.user_settings where user_id='00000000-0000-4000-8000-000000000551'),false,'La desconexión apaga la automatización');
select is((select status from public.email_jobs where id='20000000-0000-4000-8000-000000000552'),'PENDING','No modifica trabajos de otros usuarios');
select is((select count(*) from public.account_data_events where user_id='00000000-0000-4000-8000-000000000551' and action='GMAIL_DISCONNECTED'),1::bigint,'La desconexión queda auditada');
select lives_ok($q$select public.delete_writing_identity('00000000-0000-4000-8000-000000000551')$q$,'Se puede borrar el estilo después de desconectar');
select is((select status from public.users where id='00000000-0000-4000-8000-000000000551'),'ACTIVE','Borrar estilo conserva la identidad de acceso');
select is((select count(*) from public.account_data_events where user_id='00000000-0000-4000-8000-000000000551' and action='STYLE_DELETED'),1::bigint,'Se audita el borrado de estilo');
select throws_ok($q$select public.request_account_deletion('00000000-0000-4000-8000-000000000552','bad')$q$,'P0001','INVALID_INPUT','El resguardo requiere un hash válido');
create temporary table requested as select public.request_account_deletion('00000000-0000-4000-8000-000000000552',repeat('a',64)) id;
select is((select status from public.users where id='00000000-0000-4000-8000-000000000552'),'DELETION_PENDING','La solicitud bloquea el acceso al servicio inmediatamente');
select is((select status from public.gmail_accounts where user_id='00000000-0000-4000-8000-000000000552'),'DISCONNECTED','La solicitud retira el acceso a Gmail');
select is(public.request_account_deletion('00000000-0000-4000-8000-000000000552',repeat('b',64)),(select id from requested),'Una solicitud repetida conserva el mismo trabajo');
select is((select count(*) from public.account_deletion_requests where user_id='00000000-0000-4000-8000-000000000552'),1::bigint,'La solicitud es idempotente');
create temporary table claimed as select * from public.claim_account_deletion((select id from requested));
select is((select count(*) from public.claim_account_deletion((select id from requested))),0::bigint,'Dos workers no reclaman el mismo borrado');
select throws_ok($q$select public.advance_account_deletion((select id from requested),(select lease_id from claimed),'COMPLETED','CONFIRMED')$q$,'P0001','DELETION_NOT_FINISHED','No se declara completado si Auth conserva la cuenta');
select is(public.advance_account_deletion((select id from requested),(select lease_id from claimed),'FILES','UNCONFIRMED'),true,'Se avanza aunque Google no confirme la revocación');
select is((select encrypted_refresh_token from public.gmail_accounts where user_id='00000000-0000-4000-8000-000000000552'),null::bytea,'Se eliminan las credenciales después de intentar revocar');
select is(public.advance_account_deletion((select id from requested),(select lease_id from claimed),'FILES','UNCONFIRMED','STORAGE_UNAVAILABLE'),true,'Un fallo queda pendiente de reintento');
select is((select status from public.account_deletion_requests where id=(select id from requested)),'RETRY','Se conserva el estado de reintento');
select is(public.purge_account_data((select id from requested),(select lease_id from claimed)),false,'La lease retirada ya no permite borrar datos');
update public.account_deletion_requests set next_attempt_at=clock_timestamp() where id=(select id from requested);
delete from claimed;insert into claimed select * from public.claim_account_deletion((select id from requested));
select is(public.advance_account_deletion((select id from requested),(select lease_id from claimed),'DATA','UNCONFIRMED'),true,'Se reanuda la limpieza');
select is(public.purge_account_data((select id from requested),(select lease_id from claimed)),true,'La limpieza elimina datos activos de la cuenta');
select is((select count(*) from public.email_jobs where user_id='00000000-0000-4000-8000-000000000552'),0::bigint,'Se borran los trabajos y sus referencias');
select is(public.advance_account_deletion((select id from requested),(select lease_id from claimed),'AUTH','UNCONFIRMED'),true,'La identidad se elimina después de los datos');
create temporary table audit_before_completion as select count(*) total from public.account_data_events where action='ACCOUNT_DELETED';
delete from auth.users where id='00000000-0000-4000-8000-000000000552';
select is(public.advance_account_deletion((select id from requested),(select lease_id from claimed),'COMPLETED','UNCONFIRMED'),true,'Se confirma la eliminación tras borrar Auth');
select is((select user_id from public.account_deletion_requests where id=(select id from requested)),null::uuid,'El resguardo final no conserva la identidad');
select is((select count(*) from public.account_data_events where action='ACCOUNT_DELETED'),(select total+1 from audit_before_completion),'La finalización queda auditada sin identidad');
select ok(not has_function_privilege('authenticated','public.request_account_deletion(uuid,text)','EXECUTE'),'El navegador no puede borrar otros usuarios directamente');
select ok(not has_table_privilege('anon','public.account_deletion_requests','SELECT'),'Los resguardos no son públicos');
update public.account_deletion_requests set completed_at=clock_timestamp()-interval '31 days' where id=(select id from requested);
select lives_ok('select public.purge_account_audit()','Se aplica el plazo de conservación del resguardo');
select is((select count(*) from public.account_deletion_requests where id=(select id from requested)),0::bigint,'El resguardo caduca después de 30 días');
select * from finish();
rollback;
