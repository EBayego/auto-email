begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('authenticated',fn,'EXECUTE'),'Solo backend: '||fn) from unnest(array[
  'public.save_onboarding_consent(uuid,jsonb,text,boolean)', 'public.control_onboarding_analysis(uuid,uuid,text)',
  'public.claim_onboarding_analysis()', 'public.advance_onboarding_analysis(uuid,uuid,text,integer,integer)',
  'public.finish_onboarding_analysis(uuid,uuid,text,jsonb)']) fn;
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000051','authenticated','authenticated','mail051@example.invalid'),
 ('00000000-0000-4000-8000-000000000052','authenticated','authenticated','mail051-other@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000251','00000000-0000-4000-8000-000000000051','mail051@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
select throws_ok($q$select public.save_onboarding_consent('00000000-0000-4000-8000-000000000051','{"after":"2026-01-01","before":"2026-10-01","maxCandidates":200,"excludedAddresses":[],"excludedDomains":[]}','mail051-v1',false)$q$,'P0001','CONSENT_REQUIRED','No registra aceptación implícita');
select throws_ok($q$select public.control_onboarding_analysis('00000000-0000-4000-8000-000000000051',gen_random_uuid(),'START')$q$,'P0001','CONSENT_REQUIRED','No encola sin consentimiento');
select ok(not public.valid_onboarding_scope('{"after":"2026-02-30","before":"2026-10-01","maxCandidates":200,"excludedAddresses":[],"excludedDomains":[]}'),'Valida fecha real');
select ok(public.save_onboarding_consent('00000000-0000-4000-8000-000000000051','{"after":"2026-01-01","before":"2026-10-01","maxCandidates":200,"excludedAddresses":[],"excludedDomains":[]}','mail051-v1',true),'Guarda consentimiento y alcance');
select is((select count(*) from public.claim_onboarding_analysis()),0::bigint,'Consentir o conectar no inicia el análisis');
select throws_ok($q$select public.control_onboarding_analysis('00000000-0000-4000-8000-000000000051',gen_random_uuid(),'START')$q$,'P0001','STALE_CONSENT','No utiliza un alcance obsoleto');
select public.control_onboarding_analysis(user_id,consent_revision,'START') from public.gmail_onboarding;
select public.control_onboarding_analysis(user_id,consent_revision,'START') from public.gmail_onboarding;
select is((select count(*) from public.gmail_onboarding where status='QUEUED'),1::bigint,'Doble clic solo crea una solicitud');
select throws_ok($q$select public.save_onboarding_consent('00000000-0000-4000-8000-000000000051','{"after":"2026-01-01","before":"2026-10-01","maxCandidates":200,"excludedAddresses":[],"excludedDomains":[]}','mail051-v1',true)$q$,'P0001','ANALYSIS_BUSY','No cambia el alcance durante la ejecución');
create temporary table job51 as select * from public.claim_onboarding_analysis();
select is((select count(*) from job51),1::bigint,'Worker obtiene solicitud explícita');
select is((select count(*) from public.claim_onboarding_analysis()),0::bigint,'Otro worker no reclama la misma solicitud');
select ok(public.advance_onboarding_analysis(user_id,lease_id,'SAMPLING',2,0),'Actualiza progreso') from job51;
select public.control_onboarding_analysis(user_id,consent_revision,'CANCEL') from public.gmail_onboarding;
select ok(not public.advance_onboarding_analysis(user_id,lease_id,'SAMPLING',3,0),'Cancelación retira el permiso de lectura') from job51;
select ok(not public.finish_onboarding_analysis(user_id,lease_id,'UNAVAILABLE'),'Cancelación impide publicar resultados tardíos') from job51;
select public.control_onboarding_analysis(user_id,consent_revision,'START') from public.gmail_onboarding;
create temporary table retry51 as select * from public.claim_onboarding_analysis();
select isnt((select lease_id from retry51),(select lease_id from job51),'Reintento usa otra concesión');
select ok(not public.advance_onboarding_analysis(user_id,lease_id,'SAMPLING',3,0),'Worker antiguo no continúa tras reintento') from job51;
update public.gmail_accounts set status='PAUSED' where user_id='00000000-0000-4000-8000-000000000051';
select is((select status from public.gmail_onboarding),'CANCELLED','Pausa cancela la ejecución');
select ok(not public.finish_onboarding_analysis(user_id,lease_id,'UNAVAILABLE'),'Pausa impide completar') from retry51;
update public.gmail_accounts set status='CONNECTED' where user_id='00000000-0000-4000-8000-000000000051';
select is((select count(*) from public.claim_onboarding_analysis()),0::bigint,'Reactivar no vuelve a analizar sin una solicitud');
select public.control_onboarding_analysis(user_id,consent_revision,'START') from public.gmail_onboarding;
create temporary table expiry51 as select * from public.claim_onboarding_analysis();
update public.gmail_onboarding set lease_expires_at=clock_timestamp()-interval '1 second';
select ok(not public.advance_onboarding_analysis(user_id,lease_id,'SAMPLING',3,0),'Concesión caducada no puede renovarse') from expiry51;
select is((select count(*) from public.claim_onboarding_analysis()),0::bigint,'No repite automáticamente llamadas tras interrupción');
select is((select error_code from public.gmail_onboarding),'ANALYSIS_INTERRUPTED','Interrupción recuperable queda registrada');
select public.control_onboarding_analysis(user_id,consent_revision,'START') from public.gmail_onboarding;
update public.users set status='DISABLED' where id='00000000-0000-4000-8000-000000000051';
select is((select status from public.gmail_onboarding),'CANCELLED','Baja de usuario cancela trabajos');
update public.users set status='ACTIVE' where id='00000000-0000-4000-8000-000000000051';
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000051';
select is((select count(*) from public.gmail_onboarding),1::bigint,'Puede consultar el estado propio');
select throws_ok('select lease_id from public.gmail_onboarding','42501',null,'No expone la concesión del worker');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000052';
select is((select count(*) from public.gmail_onboarding),0::bigint,'No puede consultar a otro usuario');
reset role;
select * from finish();
rollback;
