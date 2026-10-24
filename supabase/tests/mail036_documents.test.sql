begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000036','authenticated','authenticated','mail036@example.invalid'),
 ('00000000-0000-4000-8000-000000000136','authenticated','authenticated','mail036-other@example.invalid');
select ok((select not public from storage.buckets where id='knowledge-documents'),'Bucket privado');
select ok(not has_function_privilege('authenticated','public.reserve_source_document(uuid,text,text,integer,text)','EXECUTE'),'No reserva desde cliente');
select ok(not has_function_privilege('anon','public.complete_source_document(uuid,uuid,text)','EXECUTE'),'No completa desde anon');
select ok(not has_table_privilege('authenticated','public.source_documents','INSERT'),'No salta validación');
select ok(not has_table_privilege('authenticated','public.source_document_texts','INSERT'),'No inyecta texto');
create temporary table doc36 as select * from public.reserve_source_document('00000000-0000-4000-8000-000000000036','tarifas.txt','text/plain',20,repeat('a',64));
select throws_ok($q$select public.reserve_source_document('00000000-0000-4000-8000-000000000036','otra.txt','text/plain',20,repeat('b',64))$q$,'P0001','DOCUMENT_BUSY','Acota procesamiento concurrente');
select ok(not public.complete_source_document('00000000-0000-4000-8000-000000000136',id,'Intento ajeno'),'Completar exige propietario') from doc36;
select ok(public.complete_source_document('00000000-0000-4000-8000-000000000036',id,'Tarifa vigente: 125 EUR.'),'Texto y estado se guardan juntos') from doc36;
grant select on doc36 to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000136","role":"authenticated"}',true);
select is((select count(*) from public.source_documents),0::bigint,'Otro usuario no lee metadatos');
select is((select count(*) from public.source_document_texts),0::bigint,'Otro usuario no lee texto');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000036","role":"authenticated"}',true);
select is((select count(*) from public.source_documents),1::bigint,'Propietario lee documento');
select is((select count(*) from public.source_document_texts),1::bigint,'Propietario lee texto listo');
reset role;
select ok(not public.begin_source_document_deletion('00000000-0000-4000-8000-000000000136',id),'Borrar exige propietario') from doc36;
select ok(public.begin_source_document_deletion('00000000-0000-4000-8000-000000000036',id),'Retira documento') from doc36;
select is((select count(*) from public.source_document_texts),0::bigint,'Borrado invalida derivados antes de Storage');
select ok(not public.complete_source_document('00000000-0000-4000-8000-000000000036',id,'Respuesta tardía'),'No resucita documento retirado') from doc36;
insert into public.source_documents(user_id,name,mime_type,byte_size,sha256,status,error_code)
select '00000000-0000-4000-8000-000000000036','doc'||n||'.txt','text/plain',20,repeat('b',64),'FAILED','INVALID_FORMAT' from generate_series(1,9) n;
select throws_ok($q$select public.reserve_source_document('00000000-0000-4000-8000-000000000036','once.txt','text/plain',20,repeat('c',64))$q$,'P0001','DOCUMENT_LIMIT','Máximo 10 incluyendo pendientes de retirada');
delete from public.source_documents where id=(select id from doc36);
select lives_ok($q$select public.reserve_source_document('00000000-0000-4000-8000-000000000036','nueva.txt','text/plain',20,repeat('c',64))$q$,'Retirada libera cuota');
select * from finish();
rollback;
