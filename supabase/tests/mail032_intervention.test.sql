begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
select ok(public.email_job_transition_allowed('GENERATING','SKIPPED'),'Puede omitir tras una clasificación completada');
select ok(not public.email_job_transition_allowed('SKIPPED','GENERATING'),'No reabre una omisión');
select ok(not public.email_job_intervention_reason('SKIPPED',null),'Exige razón estructurada');
select ok(not public.email_job_intervention_reason('SKIPPED','PRIVATE_FREE_TEXT'),'No permite omisión arbitraria');
select ok(public.email_job_intervention_reason('SKIPPED',reason),'Razón de omisión permitida: ' || reason)
from unnest(array['EXISTING_MANUAL_DRAFT','EXISTING_SYSTEM_DRAFT','TARGET_ALREADY_PROCESSED','ALREADY_ANSWERED','TARGET_SUPERSEDED','TARGET_NOT_ELIGIBLE']) reason;
select ok(public.email_job_intervention_reason('REVIEW_REQUIRED',reason),'Razón de revisión permitida: ' || reason)
from unnest(array['DRAFT_RECONCILIATION_REQUIRED','DRAFT_ATTEMPT_CANCELLED','POSSIBLE_EXISTING_REPLY','THREAD_UNVERIFIABLE']) reason;
select ok(not has_function_privilege('authenticated','public.email_job_intervention_reason(text,text)','EXECUTE'),'Ayudante interno sin acceso desde navegador');
select ok(has_function_privilege('service_role','public.email_job_intervention_reason(text,text)','EXECUTE'),'Backend puede validar motivos');
select ok(not has_function_privilege('authenticated','public.advance_email_job(uuid,uuid,uuid,uuid,text,text,text,jsonb,text)','EXECUTE'),'Reemplazar RPC conserva permisos');
insert into auth.users(id,aud,role,email) values ('00000000-0000-4000-8000-000000000032','authenticated','authenticated','mail032@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000232','00000000-0000-4000-8000-000000000032','mail032@example.invalid','CONNECTED','\x0102',
 array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
update public.user_settings set automation_enabled=false;
update public.user_settings set automation_enabled=true where user_id='00000000-0000-4000-8000-000000000032';
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000232','manual32','thread32');
create temporary table job32 as select * from public.claim_email_job(300);
select throws_ok($q$select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'CLASSIFYING','SKIPPED') from job32$q$,
 'P0001','MISSING_JOB_CLASSIFICATION','No omite sin clasificación o razón de intervención');
select lives_ok($q$select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'CLASSIFYING','SKIPPED','EXISTING_MANUAL_DRAFT') from job32$q$,
 'Permite omitir antes del modelo');
select ok((select status='SKIPPED' and classification is null and finished_at is not null and lease_id is null from public.email_jobs where id=(select id from job32)),
 'Guarda omisión sin clasificación inventada y libera lease');
select is((select reason_code from public.email_job_events where email_job_id=(select id from job32) order by id desc limit 1),'EXISTING_MANUAL_DRAFT','Conserva razón en historial');
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000232','generating32','thread32');
create temporary table classified32 as select * from public.claim_email_job(300);
select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'CLASSIFYING','GENERATING','EXPLICIT_QUESTION',
 '{"decision":"REPLY_REQUIRED","intent":"REQUEST_INFORMATION","reasons":["EXPLICIT_QUESTION"],"riskFlags":[],"needsAttachment":false,"source":"MODEL","modelCalls":1,"inputTokens":12,"outputTokens":4}') from classified32;
create temporary table generating32 as select * from public.claim_email_job(300,true);
select throws_ok($q$select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'GENERATING','SKIPPED','INFORMATION_ONLY') from generating32$q$,
 'P0001','MISSING_INTERVENTION_REASON','No descarta una clasificación positiva sin motivo de intervención');
select lives_ok($q$select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'GENERATING','SKIPPED','ALREADY_ANSWERED') from generating32$q$,
 'Omisión segura tras clasificación');
select ok((select status='SKIPPED' and classification->>'decision'='REPLY_REQUIRED' and generation_finished_at is not null from public.email_jobs where id=(select id from generating32)),
 'Conserva decisión completada al detectar respuesta posterior');
select is((select count(*) from public.claim_email_job(300,true)),0::bigint,'Omisiones no se reclaman otra vez');
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000232','clock32','clock_thread32');
create temporary table clock32 as select * from public.claim_email_job(300);
update public.email_jobs set started_at=clock_timestamp()+interval '5 seconds',classification_started_at=clock_timestamp()+interval '5 seconds'
where id=(select id from clock32);
select lives_ok($q$select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'CLASSIFYING','SKIPPED','EXISTING_MANUAL_DRAFT') from clock32$q$,
 'Completa la comprobación aunque el reloj retroceda tras el inicio');
select ok((select classification_finished_at >= classification_started_at and finished_at >= started_at from public.email_jobs where id=(select id from clock32)),
 'Las marcas de fin no retroceden respecto al inicio');
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000232','recover_clock32','recover_thread32');
create temporary table recover_clock32 as select * from public.claim_email_job(300);
select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'CLASSIFYING','GENERATING','EXPLICIT_QUESTION',
 '{"decision":"REPLY_REQUIRED","intent":"REQUEST_INFORMATION","reasons":["EXPLICIT_QUESTION"],"riskFlags":[],"needsAttachment":false,"source":"MODEL","modelCalls":1,"inputTokens":12,"outputTokens":4}') from recover_clock32;
create temporary table recover_generating32 as select * from public.claim_email_job(300,true);
update public.email_jobs set generation_started_at=clock_timestamp()+interval '5 seconds',lease_expires_at='2000-01-01'
where id=(select id from recover_generating32);
select is(public.recover_email_jobs(),1,'Recupera generación incluso tras corrección hacia atrás del reloj');
select ok((select generation_finished_at >= generation_started_at and status='REVIEW_REQUIRED' from public.email_jobs where id=(select id from recover_generating32)),
 'La recuperación conserva la cronología y evita repetir la escritura');
select * from finish();
rollback;
