begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public,extensions;
select no_plan();
select ok(not has_schema_privilege('authenticated','worker_private','USAGE'),'El navegador no accede al esquema de cuotas');
select ok(not has_function_privilege('authenticated','public.acquire_provider_request(text,integer,integer,integer,integer,integer,uuid,uuid)','EXECUTE'),'Solo backend adquiere permisos');
select ok(not has_function_privilege('anon','public.cooldown_provider_requests(text,bigint,uuid,uuid)','EXECUTE'),'Un anónimo no bloquea proveedores');
select ok(has_function_privilege('service_role','public.release_provider_request(uuid,uuid,uuid)','EXECUTE'),'Backend libera permisos');
select ok((select relrowsecurity from pg_class where oid='worker_private.provider_requests'::regclass),'RLS en peticiones');
select ok((select relrowsecurity from pg_class where oid='worker_private.provider_request_scopes'::regclass),'RLS en suspensiones');
select throws_ok($q$select public.acquire_provider_request('google',30,0,1,100,50)$q$,'P0001','INVALID_PROVIDER_LIMITS','Valida límites');
select throws_ok($q$select public.acquire_provider_request(null,30,1,1,100,50)$q$,'P0001','INVALID_PROVIDER_LIMITS','Rechaza proveedor nulo');
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000033','authenticated','authenticated','mail033@example.invalid'),
 ('00000000-0000-4000-8000-000000000133','authenticated','authenticated','mail033-other@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000233','00000000-0000-4000-8000-000000000033','mail033@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']),
 ('00000000-0000-4000-8000-000000000333','00000000-0000-4000-8000-000000000133','mail033-other@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
delete from worker_private.provider_requests;
delete from worker_private.provider_request_scopes;
create temporary table permit33 as select * from public.acquire_provider_request('google',30,1,1,100,50,
 '00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233');
select ok((select lease_id is not null and retry_after_ms=0 from permit33),'Adquiere primer permiso');
select ok((select lease_id is null and retry_after_ms>0 from public.acquire_provider_request('google',30,1,1,100,50,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000333')),'El límite global incluye otras cuentas');
select public.release_provider_request(lease_id,'00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000333') from permit33;
select ok((select not released from worker_private.provider_requests where id=(select lease_id from permit33)),'Otro propietario no libera el permiso');
select public.release_provider_request(lease_id,'00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233') from permit33;
select ok((select released from worker_private.provider_requests where id=(select lease_id from permit33)),'Propietario libera su permiso');
select ok((select lease_id is null and retry_after_ms>0 from public.acquire_provider_request('google',30,4,1,1,50,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000333')),'Liberar no devuelve la cuota de llamadas del minuto');
select ok((select lease_id is null and retry_after_ms>0 from public.acquire_provider_request('google',30,4,1,100,1,
 '00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233')),'Límite de llamadas por cuenta');
create temporary table other_permit33 as select * from public.acquire_provider_request('google',30,4,1,100,1,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000333');
select ok((select lease_id is not null from other_permit33),'Otra cuenta conserva su cuota');
select ok((select lease_id is null from public.acquire_provider_request('google',30,4,1,100,50,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000333')),'Concurrencia por cuenta independiente del límite global');
update worker_private.provider_requests set expires_at=started_at+interval '1 second',started_at=clock_timestamp()-interval '120 seconds' where id=(select lease_id from other_permit33);
update worker_private.provider_requests set expires_at=clock_timestamp()-interval '1 second' where id=(select lease_id from other_permit33);
select ok((select lease_id is not null from public.acquire_provider_request('google',30,4,1,100,50,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000333')),'Un permiso expirado no bloquea tras una caída');
select public.cooldown_provider_requests('google',60000,'00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233');
select ok((select lease_id is null and retry_after_ms>50000 from public.acquire_provider_request('google',30,4,1,100,50,
 '00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233')),'Retry-After se comparte entre workers de la cuenta');
select public.cooldown_provider_requests('openai',60000,'00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233');
select ok((select lease_id is null and retry_after_ms>50000 from public.acquire_provider_request('openai',30,4,1,100,50,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000333')),'OpenAI comparte suspensión del proyecto');
select throws_ok($q$select public.acquire_provider_request('google',30,4,1,100,50,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000233')$q$,'P0001','PROVIDER_ACCOUNT_NOT_ACTIVE','Revalida propietario');
select throws_ok($q$select public.cooldown_provider_requests('google',1000,
 '00000000-0000-4000-8000-000000000133','00000000-0000-4000-8000-000000000233')$q$,'P0001','PROVIDER_ACCOUNT_NOT_ACTIVE','Otro propietario no altera cuotas');
delete from worker_private.provider_requests;
delete from worker_private.provider_request_scopes;
create temporary table rolling33 as select * from public.acquire_provider_request('openai',30,1,1,1,1,
 '00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233');
select public.release_provider_request(lease_id,'00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233') from rolling33;
update worker_private.provider_requests set started_at=clock_timestamp()-interval '61 seconds',expires_at=clock_timestamp()-interval '30 seconds';
select ok((select lease_id is not null from public.acquire_provider_request('openai',30,1,1,1,1,
 '00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233')),'La cuota se recupera después de la ventana móvil');
select public.cooldown_provider_requests('openai',172800000,'00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000233');
select ok((select blocked_until > clock_timestamp()+interval '47 hours' from worker_private.provider_request_scopes where provider='openai' and scope_key='global'),
 'No acorta instrucciones Retry-After largas aunque el cliente ya no vaya a reintentar');
select * from finish();
rollback;
