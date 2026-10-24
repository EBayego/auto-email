begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
select has_column('public','draft_generations','write_started_at','Marca persistente del inicio de escritura');
select ok(not has_function_privilege('anon','public.begin_draft_write(uuid,uuid,uuid,text,text,uuid,uuid)','EXECUTE'),'Anon no puede iniciar escrituras');
select ok(not has_function_privilege('authenticated','public.begin_draft_write(uuid,uuid,uuid,text,text,uuid,uuid)','EXECUTE'),'Navegador no puede iniciar escrituras');
select ok(has_function_privilege('service_role','public.begin_draft_write(uuid,uuid,uuid,text,text,uuid,uuid)','EXECUTE'),'Backend puede iniciar escrituras');
select ok((select not prosecdef from pg_proc where oid='public.begin_draft_write(uuid,uuid,uuid,text,text,uuid,uuid)'::regprocedure),'RPC no eleva privilegios');
insert into auth.users(id,aud,role,email) values ('00000000-0000-4000-8000-000000000034','authenticated','authenticated','mail034@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000234','00000000-0000-4000-8000-000000000034','mail034@example.invalid','CONNECTED','\x0102',
 array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
update public.user_settings set automation_enabled=false;
update public.user_settings set automation_enabled=true where user_id='00000000-0000-4000-8000-000000000034';
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens)
select ('00000000-0000-4000-8000-00000000043' || n)::uuid,'00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 'thread34_' || n,'target34_' || n,'00000000-0000-4000-8000-000000000034','test-model','mail028-v2',0,0 from generate_series(1,6) n;
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000431','wrong','target34_1'),'Exige hilo exacto');
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000431','thread34_1','wrong'),'Exige objetivo exacto');
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000431','thread34_1','target34_1'),'Exige propietario exacto');
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000299',
 '00000000-0000-4000-8000-000000000431','thread34_1','target34_1'),'Exige cuenta exacta');
select ok(public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000431','thread34_1','target34_1'),'Consume permiso de reserva activa');
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000431','thread34_1','target34_1'),'Mismo intento nunca autoriza dos POST');
select ok((select write_started_at is not null and status='CREATING' from public.draft_generations where id='00000000-0000-4000-8000-000000000431'),'Inicio no implica éxito confirmado');
update public.gmail_accounts set status='DISCONNECTED' where id='00000000-0000-4000-8000-000000000234';
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000432','thread34_2','target34_2'),'Reconexión necesaria antes de escribir');
update public.gmail_accounts set status='CONNECTED' where id='00000000-0000-4000-8000-000000000234';
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000034';
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000432','thread34_2','target34_2'),'Usuario desactivado no escribe');
update public.users set status='ACTIVE' where id='00000000-0000-4000-8000-000000000034';
update public.draft_generations set status='CANCELLED',reason_code='THREAD_CHANGED' where id='00000000-0000-4000-8000-000000000432';
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234',
 '00000000-0000-4000-8000-000000000432','thread34_2','target34_2'),'Reserva cancelada no escribe');
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000234','target34_3','thread34_3');
create temporary table classified34 as select * from public.claim_email_job(300);
select public.advance_email_job(user_id,gmail_account_id,id,lease_id,'CLASSIFYING','GENERATING','EXPLICIT_QUESTION',
 '{"decision":"REPLY_REQUIRED","intent":"REQUEST_INFORMATION","reasons":["EXPLICIT_QUESTION"],"riskFlags":[],"needsAttachment":false,"source":"MODEL","modelCalls":1,"inputTokens":12,"outputTokens":4}') from classified34;
create temporary table generating34 as select * from public.claim_email_job(300,true);
select ok(not public.begin_draft_write(user_id,gmail_account_id,'00000000-0000-4000-8000-000000000433',thread_id,target_message_id,id,null),'Rechaza reserva de trabajo incompleta') from generating34;
select ok(not public.begin_draft_write(user_id,gmail_account_id,'00000000-0000-4000-8000-000000000433',thread_id,target_message_id,id,gen_random_uuid()),'Rechaza token de otro proceso') from generating34;
select ok(not public.begin_draft_write(user_id,gmail_account_id,'00000000-0000-4000-8000-000000000434','thread34_4','target34_4',id,lease_id),'No reutiliza trabajo para otro correo') from generating34;
update public.user_settings set automation_enabled=false where user_id='00000000-0000-4000-8000-000000000034';
select ok(not public.begin_draft_write(user_id,gmail_account_id,'00000000-0000-4000-8000-000000000433',thread_id,target_message_id,id,lease_id),'Automatización desactivada durante generación bloquea escritura') from generating34;
update public.user_settings set automation_enabled=true where user_id='00000000-0000-4000-8000-000000000034';
update public.email_jobs set lease_expires_at='2000-01-01' where id=(select id from generating34);
select ok(not public.begin_draft_write(user_id,gmail_account_id,'00000000-0000-4000-8000-000000000433',thread_id,target_message_id,id,lease_id),'Reserva expirada bloquea escritura') from generating34;
update public.email_jobs set lease_expires_at=clock_timestamp()+interval '1 minute' where id=(select id from generating34);
select ok(public.begin_draft_write(user_id,gmail_account_id,'00000000-0000-4000-8000-000000000433',thread_id,target_message_id,id,lease_id),'Trabajo de generación vigente autoriza exactamente su reserva') from generating34;
select ok(not public.begin_draft_write(user_id,gmail_account_id,'00000000-0000-4000-8000-000000000433',thread_id,target_message_id,id,lease_id),'Trabajo vigente tampoco puede repetir POST') from generating34;
select * from finish();
rollback;
