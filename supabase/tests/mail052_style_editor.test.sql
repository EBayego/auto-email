begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('authenticated','public.edit_writing_style(uuid,uuid,uuid,text,text,uuid,uuid[],text,jsonb,boolean)','EXECUTE'),'El navegador no ejecuta escrituras privilegiadas');
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000052','authenticated','authenticated','mail052@example.invalid'),
 ('00000000-0000-4000-8000-000000000053','authenticated','authenticated','mail052-other@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000252','00000000-0000-4000-8000-000000000052','mail052@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.style_profiles(user_id,gmail_account_id,profile,model,prompt_version,sample_size,input_tokens,output_tokens,source_message_ids) values
 ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000252',
 '{"schema_version":1,"language":"es","formality":"medium","average_length":"short","preferred_greetings":["Hola"],"preferred_closings":["Un saludo"],"vocabulary":[],"structure":"Párrafos breves.","punctuation":"Puntuación convencional.","uses_emojis":false,"style_description":"Estilo cordial y directo."}',
 'test-model','mail018-v1',1,10,10,array['sample52']);
create temporary table profile52 as select revision,profile from public.style_profiles where user_id='00000000-0000-4000-8000-000000000052';
create function pg_temp.edit52(action text,preferences jsonb default '[]',kind text default 'GENERAL',scope text default '') returns boolean language sql as $$
  select public.edit_writing_style('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000252',
    (select revision from public.style_profiles where user_id='00000000-0000-4000-8000-000000000052' and scope_kind='GENERAL'),kind,scope,
    (select revision from public.style_profiles where user_id='00000000-0000-4000-8000-000000000052' and scope_kind=kind and scope_key=scope),
    array(select revision from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052' and scope_kind=kind and scope_key=scope),action,preferences,true);
$$;
select ok(pg_temp.edit52('SAVE','[{"key":"length","value":"long"},{"key":"formality","value":"formal"}]'),'Guarda el formulario completo');
select is((select count(*) from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052'),2::bigint,'Mantiene una fila por característica');
select is((select review_status from public.style_profiles where user_id='00000000-0000-4000-8000-000000000052'),'UNREVIEWED','Guardar ajustes no confirma el perfil implícitamente');
create temporary table prefs52 as select revision from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052';
select throws_ok($q$select pg_temp.edit52('SAVE','[{"key":"length","value":"short"},{"key":"emojis","value":"invalid"}]')$q$,'23514',null,'Un ajuste inválido rechaza todo el lote');
select is((select preference_value from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052' and preference_key='length'),'long','El fallo no deja cambios parciales');
select is((select count(*) from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052'),2::bigint,'El fallo tampoco elimina ajustes previos');
select throws_ok($q$select pg_temp.edit52('SAVE','[{"key":"length","value":"short"},{"key":"length","value":"long"}]')$q$,'P0001','INVALID_INPUT','No guarda opciones contradictorias');
update public.style_preferences set preference_value='short' where user_id='00000000-0000-4000-8000-000000000052' and preference_key='length';
select throws_ok($q$select public.edit_writing_style('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000252',(select revision from profile52),'GENERAL','',(select revision from profile52),array(select revision from prefs52),'RESTORE','[]')$q$,'P0001','STALE_PREFERENCE','No restaura sobre una edición de otra ventana');
select is((select preference_value from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052' and preference_key='length'),'short','Conserva la edición más reciente');
select throws_ok($q$select public.edit_writing_style('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000252',(select revision from profile52),'GENERAL','',(select revision from profile52),array(select revision from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052'),'CONFIRM','[]',false)$q$,'P0001','INVALID_INPUT','Confirmar exige revisión explícita');
select ok(pg_temp.edit52('CONFIRM'),'Confirma una revisión concreta');
select is((select review_status from public.style_profiles where user_id='00000000-0000-4000-8000-000000000052'),'CONFIRMED','Queda disponible para el motor');
select ok((select not automation_enabled from public.user_settings where user_id='00000000-0000-4000-8000-000000000052'),'La confirmación no activa automatización');
select ok(pg_temp.edit52('SAVE','[{"key":"greeting","value":"none"}]','RELATIONSHIP','CLIENT'),'Permite preferencias contextuales aunque no haya perfil inferido específico');
select ok(pg_temp.edit52('RESTORE'),'Restaura el ámbito seleccionado');
select is((select count(*) from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052' and scope_kind='GENERAL'),0::bigint,'Elimina únicamente ajustes generales');
select is((select count(*) from public.style_preferences where user_id='00000000-0000-4000-8000-000000000052' and scope_kind='RELATIONSHIP'),1::bigint,'Conserva preferencias de otros ámbitos');
select ok((select profile=(select profile from profile52) from public.style_profiles where user_id='00000000-0000-4000-8000-000000000052'),'Restaurar no altera el estilo aprendido');
select throws_ok($q$select public.edit_writing_style('00000000-0000-4000-8000-000000000053','00000000-0000-4000-8000-000000000252',(select revision from profile52),'GENERAL','',(select revision from profile52),'{}','RESTORE','[]')$q$,'P0001','NOT_CONNECTED','No permite escribir la cuenta de otro usuario');
update public.style_profiles set revision=gen_random_uuid() where user_id='00000000-0000-4000-8000-000000000052';
select throws_ok($q$select public.edit_writing_style('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000252',(select revision from profile52),'GENERAL','',(select revision from profile52),'{}','CONFIRM','[]',true)$q$,'P0001','STALE_STYLE','No confirma un perfil que se ha regenerado');
update public.gmail_accounts set status='PAUSED' where user_id='00000000-0000-4000-8000-000000000052';
select throws_ok($q$select pg_temp.edit52('SAVE','[]')$q$,'P0001','NOT_CONNECTED','La pausa impide cambios');
select * from finish();
rollback;
