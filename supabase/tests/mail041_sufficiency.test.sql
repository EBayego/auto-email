begin;
create extension if not exists pgtap with schema extensions;
select plan(11);
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000041','authenticated','authenticated','sufficiency41@example.invalid'),
 ('00000000-0000-4000-8000-000000000141','authenticated','authenticated','foreign41@example.invalid');
create temporary table snapshot41 as select public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000041')->>'revision' as revision;
select is((select allow_partial_knowledge_drafts from public.user_settings where user_id='00000000-0000-4000-8000-000000000041'),false,'Parciales desactivadas por defecto');
select is((public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000041')->>'allowPartialDrafts')::boolean,false,'La configuración expone el valor seguro');
select ok(has_function_privilege('service_role','public.set_knowledge_sufficiency_preferences(uuid,boolean)','EXECUTE')
 and not has_function_privilege('anon','public.set_knowledge_sufficiency_preferences(uuid,boolean)','EXECUTE')
 and not has_function_privilege('authenticated','public.set_knowledge_sufficiency_preferences(uuid,boolean)','EXECUTE'),'Solo el backend guarda la preferencia');
select ok(public.set_knowledge_sufficiency_preferences('00000000-0000-4000-8000-000000000041',true),'El titular activo puede habilitarla');
select is((public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000041')->>'allowPartialDrafts')::boolean,true,'La recuperación usa la preferencia persistida');
select ok((select revision from snapshot41) <> public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000041')->>'revision','Cambiar la preferencia invalida snapshots');
select is((select allow_partial_knowledge_drafts from public.user_settings where user_id='00000000-0000-4000-8000-000000000141'),false,'No afecta al otro usuario');
select throws_ok($q$select public.set_knowledge_sufficiency_preferences('00000000-0000-4000-8000-000000000041',null)$q$,'P0001','INVALID_SOURCE_RULE','No permite valores ambiguos');
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000041';
select ok(not public.set_knowledge_sufficiency_preferences('00000000-0000-4000-8000-000000000041',false),'No modifica configuración de un usuario deshabilitado');
update public.users set status='ACTIVE' where id='00000000-0000-4000-8000-000000000041';
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000141","role":"authenticated"}';
select throws_ok($q$update public.user_settings set allow_partial_knowledge_drafts=true where user_id='00000000-0000-4000-8000-000000000041'$q$,'42501',null::text,'El navegador no modifica preferencias ajenas directamente');
reset role;
select ok((select pg_get_constraintdef(oid) like '%mail041-v1%' and pg_get_constraintdef(oid) like '%mail040-v1%' from pg_constraint where conrelid='public.draft_generations'::regclass and conname='draft_generations_prompt_version_check'),'Permite el prompt nuevo y conserva versiones anteriores');
select * from finish();
rollback;
