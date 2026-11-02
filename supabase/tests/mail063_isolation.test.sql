begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Catalog assertions cover the full schema, including future additions.
select ok(c.relrowsecurity,format('%s tiene RLS',c.oid::regclass))
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','worker_private') and c.relkind in ('r','p') order by c.oid::regclass::text;
select ok(not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'),format('anon no accede a %s',c.oid::regclass))
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','worker_private') and c.relkind in ('r','p') order by c.oid::regclass::text;
select ok(not has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_any_column_privilege('authenticated',c.oid,'INSERT,UPDATE,REFERENCES'),format('El navegador no modifica %s',c.oid::regclass))
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','worker_private') and c.relkind in ('r','p') order by c.oid::regclass::text;
select ok(not has_sequence_privilege('anon',c.oid,'USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('authenticated',c.oid,'USAGE,SELECT,UPDATE'),format('Secuencia privada: %s',c.oid::regclass))
from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='S';
select ok(not has_schema_privilege('anon','public','CREATE') and not has_schema_privilege('authenticated','public','CREATE'),'Los clientes no crean objetos públicos');
select ok(not has_schema_privilege('anon','worker_private','USAGE') and not has_schema_privilege('authenticated','worker_private','USAGE'),'El esquema del worker es privado');
select ok(not has_function_privilege('anon',p.oid,'EXECUTE'),format('RPC no anónima: %s',p.oid::regprocedure))
from pg_proc p where p.pronamespace in ('public'::regnamespace,'worker_private'::regnamespace) order by p.oid::regprocedure::text;
select ok(not has_function_privilege('authenticated',p.oid,'EXECUTE') or p.oid in (
  'public.security_access_allowed()'::regprocedure,'public.valid_factual_validation(jsonb)'::regprocedure,'public.valid_response_policy(jsonb)'::regprocedure
),format('RPC de navegador explícita: %s',p.oid::regprocedure))
from pg_proc p where p.pronamespace in ('public'::regnamespace,'worker_private'::regnamespace) order by p.oid::regprocedure::text;
select ok(p.proconfig @> array['search_path=""']::text[],format('Definer con search_path fijo: %s',p.oid::regprocedure))
from pg_proc p where p.pronamespace in ('public'::regnamespace,'worker_private'::regnamespace) and p.prosecdef;

-- Actual new objects must start closed, rather than relying on every author
-- remembering to undo the platform defaults. All fixtures roll back.
create table public.mail063_default_probe(id bigint);
create sequence public.mail063_default_probe_seq;
create function public.mail063_default_probe() returns boolean language sql as 'select true';
select ok(not has_table_privilege('anon','public.mail063_default_probe','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('authenticated','public.mail063_default_probe','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'Las nuevas tablas nacen sin privilegios de cliente');
select ok(not has_sequence_privilege('anon','public.mail063_default_probe_seq','USAGE,SELECT,UPDATE')
  and not has_sequence_privilege('authenticated','public.mail063_default_probe_seq','USAGE,SELECT,UPDATE'),'Las nuevas secuencias nacen privadas');
select ok(not has_function_privilege('anon','public.mail063_default_probe()','EXECUTE')
  and not has_function_privilege('authenticated','public.mail063_default_probe()','EXECUTE'),'Las nuevas funciones no son RPC públicas');

insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000063','authenticated','authenticated','mail063-a@example.invalid'),
 ('00000000-0000-4000-8000-000000000163','authenticated','authenticated','mail063-b@example.invalid');
\ir fixtures/privacy.inc
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('10000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000063','mail063-a@example.invalid','CONNECTED','synthetic',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']),
 ('10000000-0000-4000-8000-000000000163','00000000-0000-4000-8000-000000000163','mail063-b@example.invalid','CONNECTED','synthetic',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.email_jobs(id,user_id,gmail_account_id,thread_id,target_message_id) values
 ('20000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000063','10000000-0000-4000-8000-000000000063','thread63','message63'),
 ('20000000-0000-4000-8000-000000000163','00000000-0000-4000-8000-000000000163','10000000-0000-4000-8000-000000000163','thread63','message63');
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000063','10000000-0000-4000-8000-000000000063','message63','thread63'),
 ('00000000-0000-4000-8000-000000000163','10000000-0000-4000-8000-000000000163','message63','thread63');
insert into auth.sessions(id,user_id) values
 ('30000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000063'),
 ('30000000-0000-4000-8000-000000000163','00000000-0000-4000-8000-000000000163');

set local role service_role;
select throws_ok($q$insert into public.gmail_oauth_attempts(user_id,session_id,state_hash,code_verifier,expires_at)
 values('00000000-0000-4000-8000-000000000063','30000000-0000-4000-8000-000000000163',repeat('a',64),repeat('v',43),now()+interval '5 minutes')$q$,
 '23503','OAUTH_SESSION_OWNER_MISMATCH','El servicio no vincula OAuth a una sesión ajena');
delete from public.gmail_oauth_attempts where user_id='00000000-0000-4000-8000-000000000063';
select lives_ok($q$insert into public.gmail_oauth_attempts(user_id,session_id,state_hash,code_verifier,expires_at)
 values('00000000-0000-4000-8000-000000000063','30000000-0000-4000-8000-000000000063',repeat('a',64),repeat('v',43),now()+interval '5 minutes')$q$,
 'El servicio vincula OAuth a la sesión de su propietario');
select throws_ok($q$update public.gmail_oauth_attempts set session_id='30000000-0000-4000-8000-000000000163' where user_id='00000000-0000-4000-8000-000000000063'$q$,
 '23503','OAUTH_SESSION_OWNER_MISMATCH','Tampoco se cambia una autorización a una sesión ajena');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000063","role":"authenticated"}',true);
select is((select count(id) from public.email_jobs),1::bigint,'A ve solo sus trabajos aunque coincidan los identificadores Gmail');
select is((select count(id) from public.email_job_events),1::bigint,'A ve solo sus eventos');
select throws_ok('select message_id from public.gmail_sync_messages','42501',null::text,'La sincronización es privada del worker');
select is((select count(id) from public.email_jobs where id='20000000-0000-4000-8000-000000000163'),0::bigint,'Conocer el UUID de B no concede lectura');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000163","role":"authenticated"}',true);
select is((select count(id) from public.email_jobs),1::bigint,'B ve solo sus trabajos');
select is((select count(id) from public.email_job_events),1::bigint,'B ve solo sus eventos');
reset role;
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000063';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000063","role":"authenticated"}',true);
select is((select count(id) from public.email_jobs),0::bigint,'Un JWT previo no lee trabajos tras deshabilitar la cuenta');
select is((select count(id) from public.email_job_events),0::bigint,'Un JWT previo no lee eventos tras deshabilitar la cuenta');
select throws_ok('select message_id from public.gmail_sync_messages','42501',null::text,'La sincronización sigue privada tras deshabilitar la cuenta');
reset role;
select * from finish();
rollback;
