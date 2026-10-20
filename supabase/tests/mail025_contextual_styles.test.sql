begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temp table mail025_profile as select '{"schema_version":2,"language":"es","formality":"medium","average_length":"short","preferred_greetings":[],"preferred_closings":[],"vocabulary":[],"structure":"Breve.","punctuation":"Convencional.","uses_emojis":false,"style_description":"Directo.","form_of_address":"informal","tone":{"warmth":"warm","directness":"direct"},"structure_traits":{"sentence_length":"short","paragraph_length":"short","lists":"none"},"punctuation_traits":{"exclamations":"none","ellipses":"none","semicolons":"none"}}'::jsonb as profile;
insert into auth.users(id,aud,role,email) values
('00000000-0000-4000-8000-000000000251','authenticated','authenticated','mail025-a@example.invalid'),
('00000000-0000-4000-8000-000000000252','authenticated','authenticated','mail025-b@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
('10000000-0000-4000-8000-000000000251','00000000-0000-4000-8000-000000000251','mail025-a@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']),
('10000000-0000-4000-8000-000000000252','00000000-0000-4000-8000-000000000252','mail025-b@example.invalid','CONNECTED','\x74657374',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.style_profiles(user_id,gmail_account_id,profile,model,prompt_version,sample_size,input_tokens,output_tokens,source_message_ids)
select user_id,id,profile,'test-model','mail024-v2',1,10,10,array['sent0'] from public.gmail_accounts cross join mail025_profile where id in ('10000000-0000-4000-8000-000000000251','10000000-0000-4000-8000-000000000252');
insert into public.style_relationships(user_id,gmail_account_id,match_kind,match_key,category) values
('00000000-0000-4000-8000-000000000251','10000000-0000-4000-8000-000000000251','DOMAIN','company.invalid','CLIENT'),
('00000000-0000-4000-8000-000000000252','10000000-0000-4000-8000-000000000252','RECIPIENT','other@company.invalid','COLLEAGUE');
insert into public.style_profiles(user_id,gmail_account_id,scope_kind,scope_key,parent_revision,context_evidence,relationship_rule_revisions,profile,model,prompt_version,sample_size,input_tokens,output_tokens,source_message_ids)
select p.user_id,p.gmail_account_id,s.kind,s.key,p.revision,
  jsonb_build_object('threads',3,'days',2,'words',200,'recipients',case when s.kind='RECIPIENT' then 1 else 3 end),
  case when s.kind='RELATIONSHIP' then array(select revision from public.style_relationships where gmail_account_id=p.gmail_account_id) else '{}'::uuid[] end,
  p.profile,'test-model','mail024-v2',10,10,10,array(select 'sent'||n from generate_series(1,10)n)
from public.style_profiles p cross join (values ('RECIPIENT','person@company.invalid'),('DOMAIN','company.invalid'),('RELATIONSHIP','CLIENT'))s(kind,key)
where p.user_id='00000000-0000-4000-8000-000000000251' and p.scope_kind='GENERAL';
select is((select count(*) from public.style_profiles where user_id='00000000-0000-4000-8000-000000000251'),4::bigint,'Los perfiles general, contacto, dominio y categoría conviven');
select throws_ok($q$update public.style_profiles set scope_key='other@company.invalid' where scope_kind='RECIPIENT'$q$,'23514','PROFILE_OWNER_IMMUTABLE','No se trasladan perfiles entre destinatarios');
select throws_ok($q$update public.style_profiles set sample_size=9,source_message_ids=source_message_ids[1:9] where scope_kind='RECIPIENT'$q$,'23514',null::text,'La muestra contextual necesita al menos diez mensajes');
select throws_ok($q$update public.style_profiles set context_evidence=jsonb_set(context_evidence,'{threads}','2') where scope_kind='RECIPIENT'$q$,'23514',null::text,'Se requieren varias conversaciones');
select throws_ok($q$update public.style_profiles set context_evidence=jsonb_set(context_evidence,'{days}','1') where scope_kind='RECIPIENT'$q$,'23514',null::text,'Se requieren días distintos');
select throws_ok($q$update public.style_profiles set context_evidence=jsonb_set(context_evidence,'{recipients}','1') where scope_kind='DOMAIN'$q$,'23514',null::text,'Un solo contacto no representa un dominio');
select throws_ok($q$update public.style_profiles set context_evidence=context_evidence||'{"sensitive_trait":"private"}' where scope_kind='RECIPIENT'$q$,'23514',null::text,'La evidencia no acepta características personales');
select throws_ok($q$update public.style_profiles set parent_revision=null where scope_kind='RECIPIENT'$q$,'23514',null::text,'El contexto identifica el perfil general de origen');
select throws_ok($q$update public.style_relationships set category='HEALTH_STATUS'$q$,'23514',null::text,'Solo se permiten categorías profesionales explícitas');
select throws_ok($q$insert into public.style_relationships(user_id,gmail_account_id,match_kind,match_key,category) values('00000000-0000-4000-8000-000000000251','10000000-0000-4000-8000-000000000252','DOMAIN','other.invalid','CLIENT')$q$,'23503',null::text,'La configuración no puede pertenecer a otra cuenta');
grant usage on schema extensions to authenticated,anon;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000251","role":"authenticated"}';
select is((select count(*) from public.style_profiles),4::bigint,'RLS solo expone los perfiles propios sin filtros del cliente');
select is((select count(*) from public.style_relationships),1::bigint,'RLS solo expone las asignaciones propias');
select is((select count(*) from public.style_relationships where user_id='00000000-0000-4000-8000-000000000252'),0::bigint,'Conocer otro usuario no revela sus relaciones');
select throws_ok('update public.style_relationships set category=''OTHER''','42501',null::text,'El navegador no reasigna categorías directamente');
reset role;
set local role anon;
select throws_ok('select * from public.style_relationships','42501',null::text,'Anon no lee relaciones');
reset role;
create temp table mail025_rule as select revision from public.style_relationships where match_kind='DOMAIN';
update public.style_relationships set category='CLIENT' where match_kind='DOMAIN';
select is((select revision from public.style_relationships where match_kind='DOMAIN'),(select revision from mail025_rule),'Guardar la misma categoría conserva su revisión');
select is((select count(*) from public.style_profiles where scope_kind='RELATIONSHIP'),1::bigint,'Una asignación idéntica conserva los perfiles');
update public.style_relationships set category='SUPPLIER' where match_kind='DOMAIN';
select isnt((select revision from public.style_relationships where match_kind='DOMAIN'),(select revision from mail025_rule),'Reasignar cambia la revisión de configuración');
select is((select count(*) from public.style_profiles where scope_kind='RELATIONSHIP'),0::bigint,'Reasignar invalida los perfiles de categoría anteriores');
select is((select count(*) from public.style_profiles where scope_kind in ('RECIPIENT','DOMAIN')),2::bigint,'Los estilos de contacto y dominio conservan su evidencia independiente');
select lives_ok('delete from public.style_relationships where match_kind=''DOMAIN''','Se puede retirar la asignación sin errores de trigger');
select * from finish();
rollback;
