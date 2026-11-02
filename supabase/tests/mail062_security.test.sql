begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(public.security_access_allowed(),'El servicio no nace en mantenimiento');
select ok(not has_function_privilege('authenticated','public.contain_security_incident()','EXECUTE'),'Los usuarios no bloquean el servicio');
select ok(not has_function_privilege('authenticated','public.release_security_hold(boolean)','EXECUTE'),'Los usuarios no retiran el bloqueo');
select ok(not has_function_privilege('authenticated','public.recover_erasure_request(uuid)','EXECUTE'),'La recuperación de intenciones solo está disponible al worker');
select ok(not has_function_privilege('anon','public.purge_private_data()','EXECUTE'),'Las purgas no son públicas');
select ok(not has_function_privilege('authenticated','public.purge_private_data()','EXECUTE'),'El navegador no inicia purgas globales');
select ok(not has_function_privilege('authenticated','public.find_archived_draft(uuid,uuid,text)','EXECUTE'),'El archivo requiere propietario validado en el servidor');
select ok(not has_table_privilege('authenticated','public.archived_drafts','SELECT'),'Las huellas no son accesibles desde el navegador');
select ok((select active and schedule='*/5 * * * *' from cron.job where jobname='mail062-purge-private-data'),'La purga está programada cada cinco minutos');
insert into auth.users(id,aud,role,email,last_sign_in_at) values
 ('00000000-0000-4000-8000-000000000062','authenticated','authenticated','mail062-a@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000162','authenticated','authenticated','mail062-b@example.invalid',now()-interval '100 days');
\ir fixtures/privacy.inc
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set,created_at) values
 ('10000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000062','mail062-a@example.invalid','CONNECTED','test',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose'],now()),
 ('10000000-0000-4000-8000-000000000162','00000000-0000-4000-8000-000000000162','mail062-b@example.invalid','CONNECTED','test',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose'],now()-interval '100 days');
-- Backdate synthetic profiles without weakening the production version trigger.
alter table public.style_profiles disable trigger style_profiles_version;
insert into public.style_profiles(user_id,gmail_account_id,profile,model,prompt_version,sample_size,input_tokens,output_tokens,source_message_ids,generated_at)
select a.user_id,a.id,'{"schema_version":1,"language":"es","formality":"medium","average_length":"short","preferred_greetings":["Hola"],"preferred_closings":["Un saludo"],"vocabulary":[],"structure":"Párrafos breves.","punctuation":"Puntuación convencional.","uses_emojis":false,"style_description":"Estilo cordial y directo."}'::jsonb,
 'test-model','mail018-v1',1,10,10,array['sample62'],now()-interval '100 days' from public.gmail_accounts a where a.id in ('10000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000162');
alter table public.style_profiles enable trigger style_profiles_version;
insert into auth.sessions(id,user_id) values('30000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000062');
insert into public.gmail_oauth_attempts(user_id,session_id,state_hash,code_verifier,expires_at) values
 ('00000000-0000-4000-8000-000000000062','30000000-0000-4000-8000-000000000062',repeat('a',64),repeat('v',43),now()-interval '1 minute');
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,status,reason_code,created_at) values
 ('20000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000062','thread62old','target62old',gen_random_uuid(),'test-model','mail043-v1',1,1,'CANCELLED','PREWRITE_FAILED',now()-interval '100 days'),
 ('20000000-0000-4000-8000-000000000162','00000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000062','thread62new','target62new',gen_random_uuid(),'test-model','mail043-v1',1,1,'CANCELLED','PREWRITE_FAILED',now()-interval '89 days');
insert into public.generation_runs(id,user_id,gmail_account_id,thread_id,target_message_id,generation_version,status,model,configuration,duration_ms,created_at)
values(gen_random_uuid(),'00000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000062','thread62failed','target62failed',1,'FAILED','test-model',
 '{"version":"mail056-v1","promptVersion":"mail043-v1","securityVersion":"mail049-v1","responseSchemaVersion":1,"reasoningEffort":null,"maxOutputTokens":null,"styleRevision":null,"style":null,"preferences":[],"preferenceRevisions":[],"policyRevision":null,"policySettings":null,"knowledgeRevision":null,"sourceRuleIds":[],"consultedSourceIds":[],"knowledgeFragments":[],"examplesUsed":0,"allowEmailHistory":false,"allowPartialDrafts":false,"userInstructionsHash":null}',1,now()-interval '100 days');
select lives_ok('select public.purge_private_data()','La purga puede ejecutarse con referencias históricas');
set local role service_role;
select lives_ok('select public.purge_private_data()','El worker ejecuta la rutina sin acceso directo a Auth ni borrado general de eventos');
reset role;
select is((select count(*) from public.gmail_oauth_attempts where user_id='00000000-0000-4000-8000-000000000062'),0::bigint,'El verificador OAuth caducado se elimina');
select is((select count(*) from public.generation_runs where user_id='00000000-0000-4000-8000-000000000062'),0::bigint,'El historial detallado de generación caduca a los 90 días');
select is((select count(*) from public.draft_generations where id='20000000-0000-4000-8000-000000000062'),0::bigint,'La reserva antigua se purga');
select is((select count(*) from public.draft_generations where id='20000000-0000-4000-8000-000000000162'),1::bigint,'El historial dentro de plazo permanece');
select is((select count(*) from public.find_archived_draft('00000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000062','target62old')),1::bigint,'La huella evita repetir un objetivo purgado');
select is((select count(*) from public.find_archived_draft('00000000-0000-4000-8000-000000000162','10000000-0000-4000-8000-000000000062','target62old')),0::bigint,'No se mezclan propietarios');
select is((select count(*) from public.style_profiles where user_id='00000000-0000-4000-8000-000000000062'),1::bigint,'La actividad reciente conserva el perfil');
select is((select count(*) from public.style_profiles where user_id='00000000-0000-4000-8000-000000000162'),0::bigint,'Noventa días de inactividad eliminan el perfil');
select throws_ok($$insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens) values(gen_random_uuid(),'00000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000062','thread62old','target62old',gen_random_uuid(),'test-model','mail043-v1',1,1)$$,'23505','TARGET_ALREADY_PROCESSED','La base bloquea también una escritura que ignore el archivo');
select ok(public.contain_security_incident(),'Contiene el incidente');
select ok(not public.security_access_allowed(),'El bloqueo global es persistente');
select ok(not public.privacy_authorization_valid('00000000-0000-4000-8000-000000000062'),'No se autorizan proveedores durante mantenimiento');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000062',true);
select is((select count(*) from public.users),0::bigint,'RLS bloquea los datos incluso con un JWT anterior');
reset role;
select throws_ok('select public.release_security_hold(false)','P0001','REVIEW_REQUIRED','Liberar requiere revisión explícita');
select ok(public.release_security_hold(true),'La liberación se puede ejecutar tras la revisión');
select is((select status from public.gmail_accounts where id='10000000-0000-4000-8000-000000000062'),'PAUSED','La liberación no reactiva Gmail');
select ok(not (select automation_enabled from public.user_settings where user_id='00000000-0000-4000-8000-000000000062'),'La liberación no reactiva automatización');
select public.request_account_deletion('00000000-0000-4000-8000-000000000062',repeat('a',64));
select lives_ok($$select public.recover_erasure_request('00000000-0000-4000-8000-000000000062')$$,'La recuperación repetida es idempotente');
select is((select receipt_hash from public.account_deletion_requests where user_id='00000000-0000-4000-8000-000000000062'),repeat('a',64),'La recuperación conserva el resguardo del usuario');
select * from finish();
rollback;
