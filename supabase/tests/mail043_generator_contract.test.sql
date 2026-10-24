begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000043','authenticated','authenticated','contract43@example.invalid'),
 ('00000000-0000-4000-8000-000000000143','authenticated','authenticated','foreign43@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('10000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000043','contract43@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.knowledge_sources(id,user_id,title) values
 ('20000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000043','Fuente propia'),
 ('20000000-0000-4000-8000-000000000143','00000000-0000-4000-8000-000000000143','Fuente ajena');
insert into public.source_documents(id,user_id,source_id,name,mime_type,byte_size,sha256,status,has_file,text_length,indexed_at,chunk_count,indexer_version,index_hash) values
 ('30000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000043','20000000-0000-4000-8000-000000000043','datos.txt','text/plain',10,repeat('a',64),'READY',true,10,now(),1,'mail037-v1',md5('datos')),
 ('30000000-0000-4000-8000-000000000143','00000000-0000-4000-8000-000000000143','20000000-0000-4000-8000-000000000143','ajenos.txt','text/plain',10,repeat('b',64),'READY',true,10,now(),1,'mail037-v1',md5('ajenos'));
insert into public.knowledge_chunks(id,document_id,user_id,version,position,section,content,start_offset,end_offset) values
 ('40000000-0000-4000-8000-000000000043','30000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000043',1,0,'','Dato propio',0,11),
 ('40000000-0000-4000-8000-000000000143','30000000-0000-4000-8000-000000000143','00000000-0000-4000-8000-000000000143',1,0,'','Dato ajeno',0,10);
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens) values
 ('50000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000043','10000000-0000-4000-8000-000000000043','thread43','target43',gen_random_uuid(),'test-model','mail043-v1',10,10);
select is((select sources_used from public.draft_generations where id='50000000-0000-4000-8000-000000000043'),'[]'::jsonb,'No inventa fuentes para registros sin citas');
select ok(public.valid_reply_sources('[{"kind":"THREAD_MESSAGE","messageIndex":0},{"kind":"HISTORICAL_MESSAGE","referenceId":"opaque-id"}]'),'Admite referencias de hilo e historial');
select ok(not public.valid_reply_sources('[{"kind":"THREAD_MESSAGE","messageIndex":0,"quote":"private"}]'),'No permite guardar citas o cuerpos');
select ok(not public.valid_reply_sources('[{"kind":"THREAD_MESSAGE","messageIndex":20}]'),'Valida límites de índices');
select ok(not public.valid_reply_sources('[{"kind":"THREAD_MESSAGE","messageIndex":0},{"kind":"THREAD_MESSAGE","messageIndex":0}]'),'No admite fuentes duplicadas');
select throws_ok($q$update public.draft_generations set sources_used='{"body":"private"}'$q$,'23514','INVALID_REPLY_SOURCES','No acepta JSON arbitrario');
select throws_ok($q$update public.draft_generations set sources_used='[{"kind":"KNOWLEDGE_FRAGMENT","sourceId":"20000000-0000-4000-8000-000000000143","documentId":"30000000-0000-4000-8000-000000000143","version":1,"chunkId":"40000000-0000-4000-8000-000000000143"}]'$q$,'23514','INVALID_REPLY_SOURCE_REFERENCE','No registra fuentes de otro titular');
select throws_ok($q$update public.draft_generations set sources_used='[{"kind":"KNOWLEDGE_FRAGMENT","sourceId":"20000000-0000-4000-8000-000000000043","documentId":"30000000-0000-4000-8000-000000000043","version":2,"chunkId":"40000000-0000-4000-8000-000000000043"}]'$q$,'23514','INVALID_REPLY_SOURCE_REFERENCE','La versión debe corresponder al fragmento usado');
update public.knowledge_sources set enabled=false where id='20000000-0000-4000-8000-000000000043';
select throws_ok($q$update public.draft_generations set sources_used='[{"kind":"KNOWLEDGE_FRAGMENT","sourceId":"20000000-0000-4000-8000-000000000043","documentId":"30000000-0000-4000-8000-000000000043","version":1,"chunkId":"40000000-0000-4000-8000-000000000043"}]'$q$,'23514','INVALID_REPLY_SOURCE_REFERENCE','No registra una fuente deshabilitada');
update public.knowledge_sources set enabled=true where id='20000000-0000-4000-8000-000000000043';
set local role service_role;
update public.draft_generations set sources_used='[{"kind":"KNOWLEDGE_FRAGMENT","sourceId":"20000000-0000-4000-8000-000000000043","documentId":"30000000-0000-4000-8000-000000000043","version":1,"chunkId":"40000000-0000-4000-8000-000000000043"}]' where id='50000000-0000-4000-8000-000000000043';
reset role;
select is((select jsonb_array_length(sources_used) from public.draft_generations where id='50000000-0000-4000-8000-000000000043'),1,'El backend guarda la procedencia válida');
delete from public.source_documents where id='30000000-0000-4000-8000-000000000043';
select is((select jsonb_array_length(sources_used) from public.draft_generations where id='50000000-0000-4000-8000-000000000043'),1,'Conserva la referencia histórica al borrar el documento');
select ok(not has_function_privilege('anon','public.valid_reply_sources(jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.check_draft_source_references()','EXECUTE'),'No expone funciones internas al navegador');
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000143","role":"authenticated"}';
select is((select count(*) from public.draft_generations),0::bigint,'RLS oculta también la nueva procedencia a otros usuarios');
reset role;
select * from finish();
rollback;
