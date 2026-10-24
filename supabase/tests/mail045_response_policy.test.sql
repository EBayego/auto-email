begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000045','authenticated','authenticated','policy45@example.invalid'),
 ('00000000-0000-4000-8000-000000000145','authenticated','authenticated','foreign45@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('10000000-0000-4000-8000-000000000045','00000000-0000-4000-8000-000000000045','policy45@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.knowledge_sources(id,user_id,title) values
 ('20000000-0000-4000-8000-000000000045','00000000-0000-4000-8000-000000000045','Fuente propia'),
 ('20000000-0000-4000-8000-000000000145','00000000-0000-4000-8000-000000000145','Fuente ajena');
create temporary table settings45 as select public.get_response_policy('00000000-0000-4000-8000-000000000045')->'settings' as settings;
select ok(public.valid_response_policy((select settings from settings45)),'Configuración inicial válida y sin opciones para desactivar reglas globales');
select ok(not public.valid_response_policy((select settings||'{"allowPayments":true}' from settings45)),'No admite excepciones a las restricciones globales');
select ok(not public.valid_response_policy((select jsonb_set(settings,'{blockedCategories}','["SEND"]') from settings45)),'Categorías cerradas');
select ok(not public.valid_response_policy((select jsonb_set(settings,'{blockedSenders}','["a@example.invalid","a@example.invalid"]') from settings45)),'No permite listas duplicadas');
select ok(not public.valid_response_policy((select jsonb_set(settings,'{sourceRequirements}','[{"kind":"PRICE","sourceIds":["20000000-0000-4000-8000-000000000045"]},{"kind":"PRICE","sourceIds":["20000000-0000-4000-8000-000000000145"]}]') from settings45)),'No permite dos requisitos para el mismo tipo');
select ok(public.set_response_policy('00000000-0000-4000-8000-000000000045',
 (select jsonb_set(settings,'{sourceRequirements}','[{"kind":"PRICE","sourceIds":["20000000-0000-4000-8000-000000000045"]}]') from settings45)),'Guarda requisitos sobre fuentes propias');
select throws_ok($q$select public.set_response_policy('00000000-0000-4000-8000-000000000045',
 (select jsonb_set(settings,'{sourceRequirements}','[{"kind":"PRICE","sourceIds":["20000000-0000-4000-8000-000000000145"]}]') from settings45))$q$,'23514','INVALID_RESPONSE_POLICY_SOURCE','No permite fuentes de otro propietario');
select is(public.get_response_policy('00000000-0000-4000-8000-000000000145')->'settings',(select settings from settings45),'No modifica las políticas del otro usuario');

insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,policy_revision)
 values('30000000-0000-4000-8000-000000000045','00000000-0000-4000-8000-000000000045','10000000-0000-4000-8000-000000000045','thread45','target45',gen_random_uuid(),'test-model','mail043-v1',10,10,
 public.get_response_policy('00000000-0000-4000-8000-000000000045')->>'revision');
select ok(public.set_response_policy('00000000-0000-4000-8000-000000000045', (select jsonb_set(settings,'{blockedTopics}','["reservado"]') from settings45)),'Cambia una política después de generar');
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000045','10000000-0000-4000-8000-000000000045','30000000-0000-4000-8000-000000000045','thread45','target45'),'La barrera final no autoriza una política obsoleta');
select ok((select write_started_at is null from public.draft_generations where id='30000000-0000-4000-8000-000000000045'),'El veto no consume permiso de escritura');
select is((select count(*) from public.response_policy_events where user_id='00000000-0000-4000-8000-000000000045' and reasons=array['POLICY_CHANGED']),1::bigint,'El veto deja una traza explícita');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='response_policy_events' and column_name in ('body','body_text','subject','sender','prompt','quote','raw')),0::bigint,'La traza no conserva correo ni texto generado');
select throws_ok($q$insert into public.response_policy_events(user_id,gmail_account_id,evaluation_id,thread_id,target_message_id,policy_revision,engine_version,phase,action,reasons)
 values('00000000-0000-4000-8000-000000000045','10000000-0000-4000-8000-000000000045',gen_random_uuid(),'thread45','target45',repeat('a',32),'mail045-v1','POSTFLIGHT','BLOCK',array['private-body'])$q$,'23514',null::text,'La traza solo admite motivos enumerados');
select throws_ok($q$insert into public.response_policy_events(user_id,gmail_account_id,evaluation_id,thread_id,target_message_id,policy_revision,engine_version,phase,action,reasons)
 values('00000000-0000-4000-8000-000000000145','10000000-0000-4000-8000-000000000045',gen_random_uuid(),'thread45','target45',repeat('a',32),'mail045-v1','POSTFLIGHT','BLOCK',array['TOPIC_BLOCKED'])$q$,'23503',null::text,'La cuenta y el titular de la traza deben coincidir');

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000145","role":"authenticated"}';
select is((select count(*) from public.response_policy_events),0::bigint,'RLS oculta trazas ajenas');
select throws_ok($q$select public.get_response_policy('00000000-0000-4000-8000-000000000045')$q$,'42501',null::text,'El RPC interno no está expuesto al navegador');
select throws_ok($q$update public.user_settings set response_policy='{}' where user_id='00000000-0000-4000-8000-000000000045'$q$,'42501',null::text,'El navegador no modifica políticas directamente');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000045","role":"authenticated"}';
select is((select count(*) from public.response_policy_events),1::bigint,'El titular puede consultar sus motivos');
select throws_ok($q$delete from public.response_policy_events$q$,'42501',null::text,'El navegador no borra la trazabilidad');
reset role;
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000045';
select ok(public.get_response_policy('00000000-0000-4000-8000-000000000045') is null,'No entrega políticas de un usuario deshabilitado');
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000045','10000000-0000-4000-8000-000000000045','30000000-0000-4000-8000-000000000045','thread45','target45'),'La barrera no autoriza al titular deshabilitado');
select * from finish();
rollback;
