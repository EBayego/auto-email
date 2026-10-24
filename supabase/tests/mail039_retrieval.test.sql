begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select ok((select pg_get_constraintdef(oid) like '%mail039-v1%' from pg_constraint
  where conrelid='public.draft_generations'::regclass and conname='draft_generations_prompt_version_check'),
  'Admite la versión del prompt con evidencia documental');
select ok((select pg_get_constraintdef(oid) like '%mail020-v1%' and pg_get_constraintdef(oid) like '%mail020-v2%'
  and pg_get_constraintdef(oid) like '%mail027-v1%' and pg_get_constraintdef(oid) like '%mail028-v1%'
  and pg_get_constraintdef(oid) like '%mail028-v2%' from pg_constraint
  where conrelid='public.draft_generations'::regclass and conname='draft_generations_prompt_version_check'),
  'Conserva las versiones anteriores para su trazabilidad');
select ok(not has_function_privilege('authenticated','public.search_knowledge_source_chunks(uuid,text,uuid[],text,integer)','EXECUTE')
  and not has_function_privilege('anon','public.search_knowledge_source_chunks(uuid,text,uuid[],text,integer)','EXECUTE'),
  'La recuperación contextual sigue reservada al backend autorizado');
select ok((select relrowsecurity from pg_class where oid='public.knowledge_chunks'::regclass)
  and (select relrowsecurity from pg_class where oid='public.draft_generations'::regclass),
  'No se debilita el aislamiento de fragmentos ni borradores');
select * from finish();
rollback;
