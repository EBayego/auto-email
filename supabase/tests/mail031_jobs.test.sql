begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
select ok(public.email_job_transition_allowed('PENDING','CLASSIFYING'),'Entrada a clasificación');
select ok(not public.email_job_transition_allowed('PENDING','DRAFT_CREATED'),'No se saltan etapas');
select ok(not public.email_job_transition_allowed('DRAFT_CREATED','GENERATING'),'No repite un borrador confirmado');
select ok((select relrowsecurity from pg_class where oid='public.email_jobs'::regclass),'RLS en trabajos');
select ok((select relrowsecurity from pg_class where oid='public.email_job_events'::regclass),'RLS en historial');
select ok(not has_function_privilege('authenticated','public.claim_email_job(integer,boolean)','EXECUTE'),'El navegador no reclama trabajos');
select ok(not has_column_privilege('authenticated','public.email_jobs','lease_id','SELECT'),'El navegador no lee tokens de bloqueo');
select ok(not has_table_privilege('authenticated','public.email_jobs','UPDATE'),'El navegador no modifica estados directamente');
select ok(not public.valid_email_job_classification('{"body":"private"}'),'No admite contenido de correo');

create temporary table result_classification as select '{"decision":"REPLY_REQUIRED","intent":"REQUEST_INFORMATION","reasons":["EXPLICIT_QUESTION"],"riskFlags":[],"needsAttachment":false,"source":"MODEL","modelCalls":1,"inputTokens":12,"outputTokens":4}'::jsonb as value;
select ok(public.valid_email_job_classification((select value from result_classification)),'Clasificación estructurada válida');
select ok(not public.valid_email_job_classification((select value || '{"decision":null}'::jsonb from result_classification)),'Rechaza decisión nula');
select ok(not public.valid_email_job_classification((select value || '{"explanation":"private"}'::jsonb from result_classification)),'No persiste explicación libre');
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000031','authenticated','authenticated','mail031@example.invalid'),
 ('00000000-0000-4000-8000-000000000131','authenticated','authenticated','mail031-other@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000231','00000000-0000-4000-8000-000000000031','mail031@example.invalid','CONNECTED','\x0102',
 array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
update public.user_settings set automation_enabled=false;
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000231','m1','t1');
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000231','m1','t1') on conflict do nothing;
select is((select count(*) from public.email_jobs where gmail_account_id='00000000-0000-4000-8000-000000000231'),1::bigint,'Encolado atómico y único con la detección');
select is((select count(*) from public.email_job_events where gmail_account_id='00000000-0000-4000-8000-000000000231'),1::bigint,'Registra creación del trabajo');
select is((select count(*) from public.claim_email_job(300)),0::bigint,'Respeta automatización desactivada');
update public.user_settings set automation_enabled=true where user_id='00000000-0000-4000-8000-000000000031';
create temporary table first_job as select * from public.claim_email_job(300);
select is((select count(*) from first_job),1::bigint,'Reclama un trabajo pendiente');
select is((select count(*) from public.claim_email_job(300)),0::bigint,'No lo reclama dos veces');
select ok(not (select public.renew_email_job('00000000-0000-4000-8000-000000000131',gmail_account_id,id,lease_id,300) from first_job),'Revalida propietario');
select is((select count(*) from first_job j, lateral public.advance_email_job(j.user_id,j.gmail_account_id,j.id,gen_random_uuid(),'CLASSIFYING','FAILED','UNAVAILABLE')),0::bigint,'Rechaza lease incorrecto');
select lives_ok($q$select public.advance_email_job(j.user_id,j.gmail_account_id,j.id,j.lease_id,'CLASSIFYING','SKIPPED','INFORMATION_ONLY',
  c.value || '{"decision":"NO_REPLY","reasons":["INFORMATION_ONLY"]}'::jsonb) from first_job j cross join result_classification c$q$,'Completa un correo sin respuesta');
select is((select status from public.email_jobs where id=(select id from first_job)),'SKIPPED','Estado final inequívoco');
select ok((select classification_finished_at is not null and finished_at is not null and lease_id is null from public.email_jobs where id=(select id from first_job)),'Cierra etapa y libera bloqueo');
select throws_ok($q$update public.email_jobs set status='CLASSIFYING' where id=(select id from first_job)$q$,'P0001','INVALID_JOB_TRANSITION','No reabre terminales');

insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000231','m2','t2');
create temporary table interrupted as select * from public.claim_email_job(300);
update public.email_jobs set lease_expires_at='2000-01-01' where id=(select id from interrupted);
select is(public.recover_email_jobs(),1,'Recupera clasificación interrumpida');
select is((select status from public.email_jobs where id=(select id from interrupted)),'PENDING','Clasificación incompleta vuelve a pendiente');
select ok(not (select public.renew_email_job(user_id,gmail_account_id,id,lease_id,300) from interrupted),'Token antiguo invalidado');
create temporary table resumed as select * from public.claim_email_job(300);
select is((select attempt_count from resumed),2,'Conserva contador de intentos');
select lives_ok($q$select public.advance_email_job(j.user_id,j.gmail_account_id,j.id,j.lease_id,'CLASSIFYING','GENERATING','EXPLICIT_QUESTION',c.value)
 from resumed j cross join result_classification c$q$,'Persiste clasificación y encola generación');
select ok((select classification is not null and classification_finished_at is not null and generation_started_at is null and lease_id is null
 from public.email_jobs where id=(select id from resumed)),'La etapa pendiente conserva clasificación sin lease activo');
select is((select count(*) from public.claim_email_job(300)),0::bigint,'Sin generador habilitado no repite la clasificación');
create temporary table generating as select * from public.claim_email_job(300,true);
select is((select status from generating),'GENERATING','Reanuda en generación');
select ok((select generation_started_at is not null and classification is not null from generating),'Marca inicio real de generación');
update public.email_jobs set lease_expires_at='2000-01-01' where id=(select id from generating);
select is(public.recover_email_jobs(),1,'Recupera generación interrumpida');
select is((select reason_code from public.email_jobs where id=(select id from generating)),'GENERATION_INTERRUPTED','Exige reconciliación de escritura incierta');
select is((select status from public.email_jobs where id=(select id from generating)),'REVIEW_REQUIRED','No repite una posible escritura Gmail');
select is((select count(*) from public.claim_email_job(300,true)),0::bigint,'El trabajo incierto no se reejecuta automáticamente');

insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000231','m3','t3');
create temporary table third_job as select * from public.claim_email_job(300);
select public.advance_email_job(j.user_id,j.gmail_account_id,j.id,j.lease_id,'CLASSIFYING','GENERATING','EXPLICIT_QUESTION',c.value)
 from third_job j cross join result_classification c;
create temporary table draft_job as select * from public.claim_email_job(300,true);
select lives_ok($q$select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'GENERATING','DRAFT_CREATED',null,null,'draft_1') from draft_job$q$,'Confirma un borrador con su identificador');
select ok((select status='DRAFT_CREATED' and draft_id='draft_1' and generation_finished_at is not null from public.email_jobs where id=(select id from draft_job)),'Conserva acción completada');
select is((select count(*) from public.claim_email_job(300,true)),0::bigint,'No vuelve a reclamar un borrador creado');
select throws_ok($q$update public.email_jobs set target_message_id='another' where id=(select id from draft_job)$q$,'P0001','IMMUTABLE_JOB_IDENTITY','Identidad del trabajo inmutable');
select ok(not (select public.retry_email_job(user_id,gmail_account_id,id) from draft_job),'Reintento no reabre borrador confirmado');
select is((select array_agg(to_status order by id) from public.email_job_events where email_job_id=(select id from draft_job)),
 array['PENDING','CLASSIFYING','GENERATING','DRAFT_CREATED']::text[],'Historial completo de estados');
select * from finish();
rollback;
