begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000049','authenticated','authenticated','security49@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('10000000-0000-4000-8000-000000000049','00000000-0000-4000-8000-000000000049','security49@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
set local role service_role;
select lives_ok($q$insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens)
 values('20000000-0000-4000-8000-000000000049','00000000-0000-4000-8000-000000000049','10000000-0000-4000-8000-000000000049','thread49','target49',gen_random_uuid(),'test-model','mail049-v1',10,10)$q$,'Backend persists the isolated prompt version');
select is((select prompt_version from public.draft_generations where id='20000000-0000-4000-8000-000000000049'),'mail049-v1','Audit identifies the new generation rules');
select lives_ok($q$update public.draft_generations set prompt_version='mail046-v1' where id='20000000-0000-4000-8000-000000000049'$q$,'Previous audit versions remain valid');
select throws_ok($q$update public.draft_generations set prompt_version='attacker-prompt' where id='20000000-0000-4000-8000-000000000049'$q$,'23514',null::text,'Unregistered prompt versions are rejected');
select lives_ok($q$insert into public.response_policy_events(user_id,gmail_account_id,evaluation_id,thread_id,target_message_id,policy_revision,engine_version,phase,action,reasons)
 values('00000000-0000-4000-8000-000000000049','10000000-0000-4000-8000-000000000049',gen_random_uuid(),'thread49','target49',repeat('a',32),'mail045-v1','PREFLIGHT','BLOCK',array['PROMPT_INJECTION'])$q$,'Backend records injection veto without storing source text');
reset role;
select * from finish();
rollback;
