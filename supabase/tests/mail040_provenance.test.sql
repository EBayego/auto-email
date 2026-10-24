begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000040','authenticated','authenticated','provenance40@example.invalid'),
 ('00000000-0000-4000-8000-000000000140','authenticated','authenticated','foreign40@example.invalid');
insert into public.knowledge_sources(id,user_id,title) values
 ('10000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000040','Fuente oficial');
insert into public.source_documents(id,user_id,source_id,name,mime_type,byte_size,sha256,status,has_file,text_length,indexed_at,chunk_count,indexer_version,index_hash,content_updated_at)
values ('20000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-000000000040',
 'tarifas.txt','text/plain',16,repeat('4',64),'READY',true,16,now(),1,'mail037-v1',md5('initial'),'2020-01-01T00:00:00Z');
insert into public.source_document_texts(document_id,user_id,text_content,normalized_text)
values ('20000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000040','Tarifa: 125 EUR.','Tarifa: 125 EUR.');
insert into public.knowledge_chunks(document_id,user_id,version,position,section,content,start_offset,end_offset)
values ('20000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000040',1,0,'','Tarifa: 125 EUR.',0,char_length('Tarifa: 125 EUR.'));
create temporary table snapshot40 as select public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000040')->>'revision' as revision;
select ok(has_function_privilege('service_role','public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer)','EXECUTE')
 and not has_function_privilege('anon','public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer)','EXECUTE'), 'Recuperación contextual solo para backend');
select ok(not has_function_privilege('authenticated','public.set_document_validity(uuid,uuid,date,date)','EXECUTE'), 'Vigencia sin escritura directa desde navegador');
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000040','tarifa',
 array['10000000-0000-4000-8000-000000000040']::uuid[],(select revision from snapshot40),20)
 where document_updated_at='2020-01-01T00:00:00Z' and valid_from is null and valid_until is null),1::bigint,'Recupera fecha real del contenido y vigencia desconocida');
select is((select count(*) from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000140','tarifa',
 array['10000000-0000-4000-8000-000000000040']::uuid[],public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000140')->>'revision',20)),0::bigint,'No recupera procedencia ajena');
select ok(public.set_document_validity('00000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000040','2026-01-01','2026-12-31'),'Guarda vigencia explícita');
select ok(not public.set_document_validity('00000000-0000-4000-8000-000000000140','20000000-0000-4000-8000-000000000040',null,null),'No modifica documentos ajenos');
select throws_ok($q$select public.set_document_validity('00000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000040','2027-01-01','2026-01-01')$q$,'23514',null::text,'Rechaza intervalo invertido');
select throws_ok($q$select public.set_document_validity('00000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000040','infinity',null)$q$,'23514',null::text,'Rechaza fechas infinitas');
select ok((select revision from snapshot40) <> public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000040')->>'revision','Cambiar vigencia invalida el snapshot de recuperación');
select throws_ok($q$select * from public.search_knowledge_context_chunks('00000000-0000-4000-8000-000000000040','tarifa',
 array['10000000-0000-4000-8000-000000000040']::uuid[],(select revision from snapshot40),20)$q$,'P0001','SOURCE_CONFIGURATION_CHANGED','No entrega vigencia obsoleta');
select is((select content_updated_at from public.source_documents where id='20000000-0000-4000-8000-000000000040'),'2020-01-01T00:00:00Z'::timestamptz,'Editar vigencia no rejuvenece contenido');
select ok(public.replace_knowledge_index('00000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000040',1,repeat('4',64),md5('Tarifa: 125 EUR.'),
 jsonb_build_object('indexer_version','mail037-v1','normalized_text','Tarifa: 125 EUR.','chunks',jsonb_build_array(jsonb_build_object('position',0,'section','','content','Tarifa: 125 EUR.','start_offset',0,'end_offset',char_length('Tarifa: 125 EUR.'),'page_start',null,'page_end',null)))),'Reindexa contenido con metadatos');
select is((select content_updated_at from public.source_documents where id='20000000-0000-4000-8000-000000000040'),'2020-01-01T00:00:00Z'::timestamptz,'Reindexar no rejuvenece contenido');
update public.source_documents set source_id=null where id='20000000-0000-4000-8000-000000000040';
select is((select content_updated_at from public.source_documents where id='20000000-0000-4000-8000-000000000040'),'2020-01-01T00:00:00Z'::timestamptz,'Reasignar fuente tampoco rejuvenece contenido');
update public.source_document_texts set text_content='Tarifa: 150 EUR.' where document_id='20000000-0000-4000-8000-000000000040';
select ok((select content_updated_at>'2020-01-01T00:00:00Z' and indexed_at is null from public.source_documents where id='20000000-0000-4000-8000-000000000040'),'Cambiar texto actualiza fecha e invalida índice');
update public.source_documents set content_updated_at='2020-01-01T00:00:00Z' where id='20000000-0000-4000-8000-000000000040';
update public.source_documents set version=2 where id='20000000-0000-4000-8000-000000000040';
select ok((select content_updated_at>'2020-01-01T00:00:00Z' from public.source_documents where id='20000000-0000-4000-8000-000000000040'),'Cambiar versión actualiza fecha del contenido');
select ok((select pg_get_constraintdef(oid) like '%mail040-v1%' and pg_get_constraintdef(oid) like '%mail039-v1%' from pg_constraint
 where conrelid='public.draft_generations'::regclass and conname='draft_generations_prompt_version_check'),'Registra el nuevo prompt sin invalidar versiones previas');
select * from finish();
rollback;
