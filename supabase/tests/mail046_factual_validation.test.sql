begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000046','authenticated','authenticated','factual46@example.invalid'),
 ('00000000-0000-4000-8000-000000000146','authenticated','authenticated','foreign46@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('10000000-0000-4000-8000-000000000046','00000000-0000-4000-8000-000000000046','factual46@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.knowledge_sources(id,user_id,title) values
 ('20000000-0000-4000-8000-000000000046','00000000-0000-4000-8000-000000000046','Tarifas');
insert into public.source_documents(id,user_id,source_id,name,mime_type,byte_size,sha256,status,has_file,text_length,indexed_at,chunk_count,indexer_version,index_hash)
 values('30000000-0000-4000-8000-000000000046','00000000-0000-4000-8000-000000000046','20000000-0000-4000-8000-000000000046','tarifas.txt','text/plain',16,repeat('4',64),'READY',true,16,now(),1,'mail037-v1',md5('initial'));
insert into public.source_document_texts(document_id,user_id,text_content,normalized_text)
 values('30000000-0000-4000-8000-000000000046','00000000-0000-4000-8000-000000000046','Tarifa: 125 EUR.','Tarifa: 125 EUR.');
insert into public.knowledge_chunks(document_id,user_id,version,position,section,content,start_offset,end_offset)
 values('30000000-0000-4000-8000-000000000046','00000000-0000-4000-8000-000000000046',1,0,'','Tarifa: 125 EUR.',0,char_length('Tarifa: 125 EUR.'));
create temporary table snapshot46 as select public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000046')->>'revision' as revision;

select ok(public.set_document_audience('00000000-0000-4000-8000-000000000046','30000000-0000-4000-8000-000000000046','RECIPIENT','CLIENT@example.invalid'),'Define destinatario explícito');
select is((select audience_key from public.source_documents where id='30000000-0000-4000-8000-000000000046'),'client@example.invalid','Normaliza dirección');
select ok((select revision from snapshot46)<>public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000046')->>'revision','Cambiar destinatario invalida el snapshot');
select throws_ok($q$select * from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000046','tarifa',array['20000000-0000-4000-8000-000000000046']::uuid[],(select revision from snapshot46),20,'client@example.invalid')$q$,'P0001','SOURCE_CONFIGURATION_CHANGED','No usa un ámbito obsoleto');
update snapshot46 set revision=public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000046')->>'revision';
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000046','tarifa',array['20000000-0000-4000-8000-000000000046']::uuid[],(select revision from snapshot46),20,'client@example.invalid')),1::bigint,'Recupera datos del destinatario correcto');
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000046','tarifa',array['20000000-0000-4000-8000-000000000046']::uuid[],(select revision from snapshot46),20,'other@example.invalid')),0::bigint,'No recupera datos de otro destinatario');
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000046','tarifa',array['20000000-0000-4000-8000-000000000046']::uuid[],(select revision from snapshot46),20)),0::bigint,'La firma antigua sin destinatario no filtra datos particulares');
select ok(not public.set_document_audience('00000000-0000-4000-8000-000000000146','30000000-0000-4000-8000-000000000046','GENERAL',''),'No altera documentos de otro propietario');
select throws_ok($q$select public.set_document_audience('00000000-0000-4000-8000-000000000046','30000000-0000-4000-8000-000000000046','DOMAIN','*.example.invalid')$q$,'23514',null::text,'No permite comodines');
select throws_ok($q$select public.set_document_audience('00000000-0000-4000-8000-000000000046','30000000-0000-4000-8000-000000000046','GENERAL','client@example.invalid')$q$,'23514',null::text,'GENERAL no admite una clave privada');
select ok(public.set_document_audience('00000000-0000-4000-8000-000000000046','30000000-0000-4000-8000-000000000046','DOMAIN','example.invalid'),'Permite alcance de dominio exacto');
update snapshot46 set revision=public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000046')->>'revision';
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000046','tarifa',array['20000000-0000-4000-8000-000000000046']::uuid[],(select revision from snapshot46),20,'other@example.invalid')),1::bigint,'Comparte solo en el dominio declarado');
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000046','tarifa',array['20000000-0000-4000-8000-000000000046']::uuid[],(select revision from snapshot46),20,'other@sub.example.invalid')),0::bigint,'No amplía dominio a subdominios');
select ok(public.set_document_audience('00000000-0000-4000-8000-000000000046','30000000-0000-4000-8000-000000000046','GENERAL',''),'Permite restablecer ámbito general');
update snapshot46 set revision=public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000046')->>'revision';
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000046','tarifa',array['20000000-0000-4000-8000-000000000046']::uuid[],(select revision from snapshot46),20)),1::bigint,'Conserva búsqueda general compatible');

create temporary table validation46 as select jsonb_build_object('version','mail046-v1','status','REVIEW_REQUIRED','bodyHash',repeat('a',64),'contextHash',repeat('b',64),'recipientHash',repeat('c',64),'evidenceHash',repeat('d',64),'claimCount',1,'issues','[{"claimIndex":0,"kind":"AMOUNT","reason":"VALUE_MISMATCH","start":0,"end":30}]'::jsonb) as value;
select ok(public.valid_factual_validation((select value from validation46)),'Valida el contrato de auditoría');
select ok(not public.valid_factual_validation((select value||'{"quote":"dato sensible"}' from validation46)),'Rechaza texto libre en auditoría');
select ok(not public.valid_factual_validation((select jsonb_set(value,'{issues,0,reason}','"PRIVATE_TEXT"') from validation46)),'Motivos enumerados');
select ok(not public.valid_factual_validation((select jsonb_set(value,'{issues,0,end}','0') from validation46)),'Posiciones válidas');
select ok(not public.valid_factual_validation((select jsonb_set(value,'{issues,0,claimIndex}','1') from validation46)),'Índices de afirmación acotados');
select ok(not public.valid_factual_validation((select value||'{"status":"SUPPORTED"}' from validation46)),'Un SUPPORTED no admite errores');
select ok(not public.valid_factual_validation((select value||'{"issues":[]}' from validation46)),'Un rechazo requiere motivo');
insert into public.response_validation_events(user_id,gmail_account_id,evaluation_id,thread_id,target_message_id,validation)
 select '00000000-0000-4000-8000-000000000046','10000000-0000-4000-8000-000000000046',gen_random_uuid(),'thread46','target46',value from validation46;
select throws_ok($q$insert into public.response_validation_events(user_id,gmail_account_id,evaluation_id,thread_id,target_message_id,validation) select '00000000-0000-4000-8000-000000000146','10000000-0000-4000-8000-000000000046',gen_random_uuid(),'thread46','target46',value from validation46$q$,'23503',null::text,'Cuenta y propietario deben coincidir');
select throws_ok($q$insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,factual_validation) select gen_random_uuid(),'00000000-0000-4000-8000-000000000046','10000000-0000-4000-8000-000000000046','thread46','target46',gen_random_uuid(),'test-model','mail046-v1',1,1,value from validation46$q$,'23514',null::text,'No reserva un borrador con un fallo factual');
select lives_ok($q$insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,factual_validation) select gen_random_uuid(),'00000000-0000-4000-8000-000000000046','10000000-0000-4000-8000-000000000046','thread46','target46',gen_random_uuid(),'test-model','mail046-v1',1,1,value||'{"status":"SUPPORTED","issues":[]}' from validation46$q$,'Persiste solo hashes y resultado admitido');

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000146","role":"authenticated"}';
select is((select count(*) from public.response_validation_events),0::bigint,'RLS oculta la auditoría ajena');
select throws_ok($q$select public.set_document_audience('00000000-0000-4000-8000-000000000046','30000000-0000-4000-8000-000000000046','GENERAL','')$q$,'42501',null::text,'El RPC de alcance solo es accesible al backend');
select ok(not has_function_privilege('authenticated','public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer,text)','EXECUTE'),'La búsqueda contextual no se expone al navegador');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000046","role":"authenticated"}';
select is((select count(*) from public.response_validation_events),1::bigint,'El titular puede revisar sus fallos');
select throws_ok($q$delete from public.response_validation_events$q$,'42501',null::text,'No permite borrar la auditoría');
reset role;
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000046';
select ok(not public.set_document_audience('00000000-0000-4000-8000-000000000046','30000000-0000-4000-8000-000000000046','GENERAL',''),'No permite cambios de un usuario deshabilitado');
select * from finish();
rollback;
