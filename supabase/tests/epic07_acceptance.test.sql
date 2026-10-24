begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email) values
 ('00000000-0000-4000-8000-000000000707','authenticated','authenticated','epic07@example.invalid');
insert into public.gmail_accounts(id,user_id,email,status,encrypted_refresh_token,scope_set) values
 ('10000000-0000-4000-8000-000000000707','00000000-0000-4000-8000-000000000707','epic07@example.invalid','CONNECTED','\x0102',array['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.compose']);
insert into public.knowledge_sources(id,user_id,title) values
 ('20000000-0000-4000-8000-000000000707','00000000-0000-4000-8000-000000000707','Authorized source');
insert into public.source_documents(id,user_id,source_id,name,mime_type,byte_size,sha256,status,has_file,text_length,indexed_at,chunk_count,indexer_version,index_hash) values
 ('30000000-0000-4000-8000-000000000707','00000000-0000-4000-8000-000000000707','20000000-0000-4000-8000-000000000707','data.txt','text/plain',10,repeat('a',64),'READY',true,10,now(),1,'mail037-v1',md5('data'));
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,knowledge_revision)
 select '40000000-0000-4000-8000-000000000707','00000000-0000-4000-8000-000000000707','10000000-0000-4000-8000-000000000707','thread707','target707',gen_random_uuid(),'test-model','mail049-v1',10,10,
 public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000707')->>'revision';
update public.knowledge_sources set enabled=false where id='20000000-0000-4000-8000-000000000707';
set local role service_role;
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000707','10000000-0000-4000-8000-000000000707','40000000-0000-4000-8000-000000000707','thread707','target707'),'Revoking a source after generation blocks the final write fence');
select ok((select write_started_at is null from public.draft_generations where id='40000000-0000-4000-8000-000000000707'),'A stale source snapshot does not consume a write permit');
select is((select count(*) from public.response_policy_events where user_id='00000000-0000-4000-8000-000000000707' and reasons=array['POLICY_CHANGED']),1::bigint,'The source-policy veto is auditable');
select throws_ok($q$update public.draft_generations set knowledge_revision=null where id='40000000-0000-4000-8000-000000000707'$q$,'23514','IMMUTABLE_KNOWLEDGE_REVISION','The bound knowledge revision cannot be erased');
reset role;
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,knowledge_revision)
 select '40000000-0000-4000-8000-000000000708','00000000-0000-4000-8000-000000000707','10000000-0000-4000-8000-000000000707','thread708','target708',gen_random_uuid(),'test-model','mail049-v1',10,10,
 public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000707')->>'revision';
set local role service_role;
select ok(public.begin_draft_write('00000000-0000-4000-8000-000000000707','10000000-0000-4000-8000-000000000707','40000000-0000-4000-8000-000000000708','thread708','target708'),'An unchanged knowledge configuration allows the write');
reset role;
insert into public.draft_generations(id,user_id,gmail_account_id,thread_id,target_message_id,style_revision,model,prompt_version,input_tokens,output_tokens,knowledge_revision)
 select '40000000-0000-4000-8000-000000000709','00000000-0000-4000-8000-000000000707','10000000-0000-4000-8000-000000000707','thread709','target709',gen_random_uuid(),'test-model','mail049-v1',10,10,
 public.get_knowledge_source_configuration('00000000-0000-4000-8000-000000000707')->>'revision';
select public.set_document_audience('00000000-0000-4000-8000-000000000707','30000000-0000-4000-8000-000000000707','RECIPIENT','someone@example.invalid');
set local role service_role;
select ok(not public.begin_draft_write('00000000-0000-4000-8000-000000000707','10000000-0000-4000-8000-000000000707','40000000-0000-4000-8000-000000000709','thread709','target709'),'Changing the document audience invalidates the generated snapshot');
reset role;
set local role authenticated;
select throws_ok($q$select knowledge_revision from public.draft_generations$q$,'42501',null::text,'Knowledge authorization metadata stays backend-only');
reset role;
select * from finish();
rollback;
