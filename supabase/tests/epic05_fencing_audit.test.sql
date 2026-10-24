begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email) values ('00000000-0000-4000-8000-000000000037','authenticated','authenticated','epic05-audit@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('00000000-0000-4000-8000-000000000237','00000000-0000-4000-8000-000000000037','epic05-audit@example.invalid','CONNECTED','\x0102',
 array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
update public.user_settings set automation_enabled=false;
update public.user_settings set automation_enabled=true where user_id='00000000-0000-4000-8000-000000000037';
insert into public.gmail_sync_messages(user_id,gmail_account_id,message_id,thread_id) values
 ('00000000-0000-4000-8000-000000000037','00000000-0000-4000-8000-000000000237','stop37','thread_stop37'),
 ('00000000-0000-4000-8000-000000000037','00000000-0000-4000-8000-000000000237','expire37','thread_expire37');
do $$declare j public.email_jobs%rowtype; begin
  for i in 1..2 loop
    select * into j from public.claim_email_job(300);
    perform public.advance_email_job(j.user_id,j.gmail_account_id,j.id,j.lease_id,'CLASSIFYING','GENERATING','EXPLICIT_QUESTION',
      '{"decision":"REPLY_REQUIRED","intent":"REQUEST_INFORMATION","reasons":["EXPLICIT_QUESTION"],"riskFlags":[],"needsAttachment":false,"source":"MODEL","modelCalls":1,"inputTokens":12,"outputTokens":4}');
  end loop;
end;$$;
create temporary table audit_jobs37 as select * from public.claim_email_job(300,true) union all select * from public.claim_email_job(300,true);
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens)
 select gen_random_uuid(),user_id,gmail_account_id,thread_id,target_message_id,'00000000-0000-4000-8000-000000000037','test-model','mail028-v2',0,0 from audit_jobs37;
select is((select count(*) from audit_jobs37),2::bigint,'Prepara dos generaciones con lease válido');

-- Simulate a control change after the initial lease check, while allocating
-- daily quota. The transaction rolls this test double back with all fixtures.
create or replace function public.daily_draft_usage(p_user_id uuid) returns bigint language plpgsql volatile security invoker set search_path='' as $$
begin
  if current_setting('epic05_audit.mode',true)='stop' then
    update public.user_settings set automation_enabled=false where user_id=p_user_id;
  else
    update public.email_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where user_id=p_user_id and status='GENERATING';
  end if;
  return 0;
end;$$;
select set_config('epic05_audit.mode','stop',true);
select ok(not public.begin_draft_write(j.user_id,j.gmail_account_id,d.id,j.thread_id,j.target_message_id,j.id,j.lease_id),
  'Desactivar mientras espera cuota impide autorizar POST') from audit_jobs37 j join public.draft_generations d using(user_id,gmail_account_id,target_message_id) where j.target_message_id='stop37';
select ok((select write_started_at is null from public.draft_generations where target_message_id='stop37'),'No consume permiso tras la desactivación');
update public.user_settings set automation_enabled=true where user_id='00000000-0000-4000-8000-000000000037';
select set_config('epic05_audit.mode','expire',true);
select ok(not public.begin_draft_write(j.user_id,j.gmail_account_id,d.id,j.thread_id,j.target_message_id,j.id,j.lease_id),
  'Expirar durante el bloqueo de cuota impide autorizar POST') from audit_jobs37 j join public.draft_generations d using(user_id,gmail_account_id,target_message_id) where j.target_message_id='expire37';
select ok((select write_started_at is null from public.draft_generations where target_message_id='expire37'),'No consume permiso con lease expirado');
select * from finish();
rollback;
