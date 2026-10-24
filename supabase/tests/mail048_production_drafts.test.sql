begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
update public.user_settings set automation_enabled=false;
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000048','authenticated','authenticated','draft48@example.invalid'),
 ('00000000-0000-4000-8000-000000000148','authenticated','authenticated','foreign48@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('10000000-0000-4000-8000-000000000048','00000000-0000-4000-8000-000000000048','draft48@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
update public.user_settings set automation_enabled=true where user_id='00000000-0000-4000-8000-000000000048';
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','target48','thread48');
create temporary table claimed48 as select * from public.claim_email_job(300,false);
select is((select count(*) from claimed48),1::bigint,'Reclama el trabajo');
select lives_ok($q$select * from public.advance_email_job('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048',
 (select id from claimed48),(select lease_id from claimed48),'CLASSIFYING','GENERATING','EXPLICIT_QUESTION',
 '{"decision":"REPLY_REQUIRED","intent":"CONFIRMATION","reasons":["EXPLICIT_QUESTION"],"riskFlags":[],"needsAttachment":false,"source":"MODEL","modelCalls":1,"inputTokens":1,"outputTokens":1}')$q$,'Clasifica antes de generar');
create temporary table generation48 as select * from public.claim_email_job(300,true);
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,email_job_id,delivery_intent,created_at)
 values('20000000-0000-4000-8000-000000000048','00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','thread48','target48',gen_random_uuid(),'test-model','mail046-v1',1,1,(select id from generation48),
 '{"version":"mail048-v1","internetMessageId":"<mail021.20000000-0000-4000-8000-000000000048@auto-email.invalid>","inReplyTo":"<incoming@example.invalid>","fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',now()-interval '10 minutes');
select ok(public.begin_draft_write('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','20000000-0000-4000-8000-000000000048','thread48','target48',(select id from generation48),(select lease_id from generation48)),'Concede permiso de escritura una sola vez');
select is((select count(*) from public.claim_draft_reconciliation(1,120)),0::bigint,'No reconcilia mientras el worker conserva el lease');
select throws_ok($q$update public.draft_generations set delivery_intent=null where id='20000000-0000-4000-8000-000000000048'$q$,'P0001','IMMUTABLE_DRAFT_IDENTITY','No cambia la huella después del POST');
select throws_ok($q$update public.draft_generations set write_started_at=null where id='20000000-0000-4000-8000-000000000048'$q$,'P0001','IMMUTABLE_DRAFT_WRITE','No recupera un permiso ya consumido');
update public.email_jobs set lease_expires_at=now()-interval '1 second' where id=(select id from generation48);
select is(public.recover_email_jobs(1),1,'Recupera un worker interrumpido sin repetir generación');
create temporary table reconcile48 as select * from public.claim_draft_reconciliation(1,120);
select is((select count(*) from reconcile48),1::bigint,'Reclama el resultado incierto');
select is((select count(*) from public.claim_draft_reconciliation(1,120)),0::bigint,'Dos reconciliadores no comparten el intento');
select ok(not public.finish_draft_reconciliation('00000000-0000-4000-8000-000000000148','10000000-0000-4000-8000-000000000048','20000000-0000-4000-8000-000000000048',(select reconciliation_lease_id from reconcile48),'FOUND','draft48','message48'),'No finaliza una cuenta ajena');
select ok(not public.finish_draft_reconciliation('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','20000000-0000-4000-8000-000000000048',gen_random_uuid(),'FOUND','draft48','message48'),'No acepta un lease distinto');
select throws_ok($q$select public.finish_draft_reconciliation('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','20000000-0000-4000-8000-000000000048',(select reconciliation_lease_id from reconcile48),'NOT_STARTED')$q$,'P0001','INVALID_RECONCILIATION_RESULT','No cancela un POST posiblemente ejecutado');
select ok(public.finish_draft_reconciliation('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','20000000-0000-4000-8000-000000000048',(select reconciliation_lease_id from reconcile48),'FOUND','draft48','message48'),'Recupera los IDs de Gmail');
select is((select status from public.draft_generations where id='20000000-0000-4000-8000-000000000048'),'CREATED','El registro queda creado');
select ok((select verified_at is not null and reconciliation_result='FOUND' and draft_id='draft48' and draft_message_id='message48' from public.draft_generations where id='20000000-0000-4000-8000-000000000048'),'Conserva identidad y verificación');
select is((select status from public.email_jobs where id=(select id from generation48)),'DRAFT_CREATED','Repara atómicamente el trabajo que había quedado para revisión');
select is((select draft_id from public.email_jobs where id=(select id from generation48)),'draft48','El trabajo conserva draftId');
select is((select count(*) from public.email_job_events where email_job_id=(select id from generation48) and reason_code='DRAFT_RECONCILED'),1::bigint,'Registra la reconciliación en el historial');
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','20000000-0000-4000-8000-000000000048','thread48','target48'),'El intento reconciliado nunca concede otro POST');
select throws_ok($q$update public.draft_generations set draft_id='other' where id='20000000-0000-4000-8000-000000000048'$q$,'P0001','IMMUTABLE_GMAIL_DRAFT','El ID estable no se sustituye al editar');
select ok(not public.finish_draft_reconciliation('00000000-0000-4000-8000-000000000048','10000000-0000-4000-8000-000000000048','20000000-0000-4000-8000-000000000048',(select reconciliation_lease_id from reconcile48),'FOUND','draft48','message48'),'Un lease finalizado no se reutiliza');
select is((select count(*) from public.claim_draft_reconciliation(1,120)),0::bigint,'No repite la reconciliación de un trabajo resuelto');
select ok(not has_function_privilege('authenticated','public.claim_draft_reconciliation(integer,integer)','EXECUTE'),'El navegador no reclama reconciliaciones');
select ok(not has_function_privilege('authenticated','public.finish_draft_reconciliation(uuid,uuid,uuid,uuid,text,text,text)','EXECUTE'),'El navegador no falsifica resultados');
select ok(not has_column_privilege('authenticated','public.draft_generations','reconciliation_lease_id','SELECT'),'El navegador no obtiene tokens de reconciliación');
select ok(not has_column_privilege('authenticated','public.draft_generations','delivery_intent','SELECT'),'La correlación aleatoria queda en el backend');
select * from finish();
rollback;
