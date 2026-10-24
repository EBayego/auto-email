begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('authenticated',fn,'EXECUTE'),'Solo backend: '||fn)
from unnest(array['public.request_manual_processing(uuid,uuid)','public.set_gmail_processing_paused(uuid,uuid,boolean)',
 'public.set_automation_settings(uuid,boolean,integer,integer)','public.gmail_execution_allowed(uuid,uuid)','public.daily_draft_usage(uuid)']) fn;
insert into auth.users(id,aud,role,email) values ('00000000-0000-4000-8000-000000000035','authenticated','authenticated','mail035@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000235','00000000-0000-4000-8000-000000000035','mail035@example.invalid','CONNECTED','\x0102',
 array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
update public.user_settings set automation_enabled=false;
select is((select count(*) from public.claim_gmail_sync(300,300,86400)),0::bigint,'Sin automatización no sincroniza');
select ok(not public.request_manual_processing('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000235'),'Solicitud exige propietario');
select ok(public.request_manual_processing('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235'),'Solicitud manual con automatización desactivada');
create temporary table sync35 as select * from public.claim_gmail_sync(300,300,86400);
select is((select trigger_kind from public.processing_runs where id=(select run_id from sync35)),'MANUAL','Registra ejecución manual real');
select ok((select not automation_enabled from public.user_settings where user_id='00000000-0000-4000-8000-000000000035'),'No habilita automatización como efecto lateral');
select ok(public.gmail_execution_allowed(user_id,gmail_account_id),'Habilita solo ejecución manual temporal') from sync35;
select is(public.record_gmail_sync_page(user_id,gmail_account_id,run_id,'[{"id":"mail35","threadId":"thread35"}]'),1,'Encola correo manual') from sync35;
select is(public.record_gmail_sync_page(user_id,gmail_account_id,run_id,'[{"id":"mail35","threadId":"thread35"}]'),0,'Solapamiento manual no duplica') from sync35;
create temporary table job35 as select * from public.claim_email_job(300);
select is((select count(*) from job35),1::bigint,'Procesa cola manual aunque automatización esté desactivada');
select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'CLASSIFYING','SKIPPED','ALREADY_ANSWERED') from job35;
select ok(public.finish_gmail_sync(user_id,gmail_account_id,run_id,true),'Completa ejecución manual sin activar automatización') from sync35;
select ok(public.set_gmail_processing_paused('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235',true),'Pausa cuenta');
select ok(not public.gmail_execution_allowed('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235'),'Pausa cancela permiso manual');
select ok(not public.request_manual_processing('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235'),'Pausa bloquea revisión manual');
select ok(public.set_gmail_processing_paused('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235',false),'Reactiva cuenta');
select is((select count(*) from public.claim_email_job(300,true)),0::bigint,'Reactivación conserva trabajo terminado');
select ok((select last_sync_at is not null from public.gmail_accounts where id='00000000-0000-4000-8000-000000000235'),'Conserva cursor al pausar y reactivar');
select public.request_manual_processing('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235');
select public.set_automation_settings('00000000-0000-4000-8000-000000000035',false,120,0);
select ok((select manual_sync_requested_at is null and manual_processing_until is null from public.gmail_accounts where id='00000000-0000-4000-8000-000000000235'),'Desactivar también cancela solicitudes manuales');
select throws_ok($q$select public.set_automation_settings('00000000-0000-4000-8000-000000000035',true,59,30)$q$,'P0001','INVALID_EXECUTION_SETTINGS','Valida intervalo');
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens)
select ('00000000-0000-4000-8000-00000000053'||n)::uuid,'00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235',
 'draft_thread35_'||n,'draft_target35_'||n,'00000000-0000-4000-8000-000000000035','test-model','mail028-v2',0,0 from generate_series(1,3) n;
select throws_ok($q$select public.begin_draft_write('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235','00000000-0000-4000-8000-000000000531','draft_thread35_1','draft_target35_1')$q$,'P0001','DAILY_DRAFT_LIMIT','Límite cero bloquea POST manual');
select public.set_automation_settings('00000000-0000-4000-8000-000000000035',true,120,1);
select ok(public.begin_draft_write('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235','00000000-0000-4000-8000-000000000531','draft_thread35_1','draft_target35_1'),'Consume última plaza diaria');
select is(public.daily_draft_usage('00000000-0000-4000-8000-000000000035'),1::bigint,'Escritura activa consume cuota');
select throws_ok($q$select public.begin_draft_write('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235','00000000-0000-4000-8000-000000000532','draft_thread35_2','draft_target35_2')$q$,'P0001','DAILY_DRAFT_LIMIT','No permite otra escritura');
update public.draft_generations set status='UNCERTAIN',reason_code='GMAIL_WRITE_UNCERTAIN' where id='00000000-0000-4000-8000-000000000531';
select is(public.daily_draft_usage('00000000-0000-4000-8000-000000000035'),1::bigint,'Resultado incierto mantiene cuota');
update public.draft_generations set write_started_at=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')-interval '1 second' where id='00000000-0000-4000-8000-000000000531';
select is(public.daily_draft_usage('00000000-0000-4000-8000-000000000035'),0::bigint,'Cuota se reinicia al cambiar el día UTC');
select ok(public.begin_draft_write('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235','00000000-0000-4000-8000-000000000532','draft_thread35_2','draft_target35_2'),'Nuevo día vuelve a admitir escritura');
update public.draft_generations set status='CANCELLED',reason_code='PREWRITE_FAILED' where id='00000000-0000-4000-8000-000000000532';
select is(public.daily_draft_usage('00000000-0000-4000-8000-000000000035'),0::bigint,'Cancelación conocida antes del POST libera capacidad');
update public.gmail_accounts set status='DISCONNECTED' where id='00000000-0000-4000-8000-000000000235';
select ok(not public.set_gmail_processing_paused('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235',false),'Reactivar no reconecta una cuenta desconectada');
select ok(not public.request_manual_processing('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000235'),'Desconexión bloquea solicitud manual');
select is((select count(*) from public.claim_gmail_sync(300,300,86400)),0::bigint,'No sincroniza cuenta desconectada');
select * from finish();
rollback;
