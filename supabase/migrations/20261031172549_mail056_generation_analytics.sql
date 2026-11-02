-- Generation attempts are separate from Gmail write reservations/idempotency.
create table public.generation_runs (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  email_job_id uuid,
  thread_id text not null check (char_length(thread_id) between 1 and 512 and thread_id ~ '^[A-Za-z0-9_-]+$'),
  target_message_id text not null check (char_length(target_message_id) between 1 and 512 and target_message_id ~ '^[A-Za-z0-9_-]+$'),
  generation_version integer not null check (generation_version > 0),
  status text not null check (status in ('READY','PARTIAL','INSUFFICIENT_CONTEXT','BLOCKED','FAILED')),
  model text not null check (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  configuration jsonb not null check (octet_length(configuration::text)<=131072 and extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"version":{"type":"string","const":"mail056-v1"},"promptVersion":{"type":"string","maxLength":64},"securityVersion":{"type":"string","maxLength":64},"responseSchemaVersion":{"type":"number","const":1},"reasoningEffort":{"anyOf":[{"type":"string","enum":["omit","none","low","medium","high","xhigh","max"]},{"type":"null"}]},"maxOutputTokens":{"anyOf":[{"type":"integer","minimum":1,"maximum":1000000},{"type":"null"}]},"styleRevision":{"anyOf":[{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},{"type":"null"}]},"style":{"anyOf":[{"oneOf":[{"type":"object","properties":{"schema_version":{"type":"number","const":1},"language":{"type":"string","maxLength":16,"pattern":"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$"},"formality":{"type":"string","enum":["low","medium","high","mixed"]},"average_length":{"type":"string","enum":["short","medium","long","mixed"]},"preferred_greetings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"preferred_closings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"vocabulary":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"structure":{"type":"string","minLength":1,"maxLength":400},"punctuation":{"type":"string","minLength":1,"maxLength":240},"uses_emojis":{"type":"boolean"},"style_description":{"type":"string","minLength":1,"maxLength":600}},"required":["schema_version","language","formality","average_length","preferred_greetings","preferred_closings","vocabulary","structure","punctuation","uses_emojis","style_description"],"additionalProperties":false},{"type":"object","properties":{"schema_version":{"type":"number","const":2},"language":{"type":"string","maxLength":16,"pattern":"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$"},"formality":{"type":"string","enum":["low","medium","high","mixed"]},"average_length":{"type":"string","enum":["short","medium","long","mixed"]},"preferred_greetings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"preferred_closings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"vocabulary":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"structure":{"type":"string","minLength":1,"maxLength":400},"punctuation":{"type":"string","minLength":1,"maxLength":240},"uses_emojis":{"type":"boolean"},"style_description":{"type":"string","minLength":1,"maxLength":600},"form_of_address":{"type":"string","enum":["informal","formal","neutral","mixed","unknown"]},"tone":{"type":"object","properties":{"warmth":{"type":"string","enum":["reserved","neutral","warm","mixed","unknown"]},"directness":{"type":"string","enum":["direct","balanced","indirect","mixed","unknown"]}},"required":["warmth","directness"],"additionalProperties":false},"structure_traits":{"type":"object","properties":{"sentence_length":{"type":"string","enum":["short","medium","long","mixed","unknown"]},"paragraph_length":{"type":"string","enum":["short","medium","long","mixed","unknown"]},"lists":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]}},"required":["sentence_length","paragraph_length","lists"],"additionalProperties":false},"punctuation_traits":{"type":"object","properties":{"exclamations":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]},"ellipses":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]},"semicolons":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]}},"required":["exclamations","ellipses","semicolons"],"additionalProperties":false}},"required":["schema_version","language","formality","average_length","preferred_greetings","preferred_closings","vocabulary","structure","punctuation","uses_emojis","style_description","form_of_address","tone","structure_traits","punctuation_traits"],"additionalProperties":false}]},{"type":"null"}]},"preferences":{"maxItems":8,"type":"array","items":{"oneOf":[{"type":"object","properties":{"key":{"type":"string","const":"greeting"},"value":{"type":"string","enum":["short","none","natural"]}},"required":["key","value"],"additionalProperties":false},{"type":"object","properties":{"key":{"type":"string","const":"language"},"value":{"type":"string","enum":["recipient","es","en","fr","de","it","pt","ca"]}},"required":["key","value"],"additionalProperties":false},{"type":"object","properties":{"key":{"type":"string","const":"length"},"value":{"type":"string","enum":["short","medium","long"]}},"required":["key","value"],"additionalProperties":false},{"type":"object","properties":{"key":{"type":"string","const":"formality"},"value":{"type":"string","enum":["informal","neutral","formal"]}},"required":["key","value"],"additionalProperties":false},{"type":"object","properties":{"key":{"type":"string","const":"closing"},"value":{"type":"string","enum":["short","none","natural"]}},"required":["key","value"],"additionalProperties":false},{"type":"object","properties":{"key":{"type":"string","const":"emojis"},"value":{"type":"string","enum":["never","allowed"]}},"required":["key","value"],"additionalProperties":false},{"type":"object","properties":{"key":{"type":"string","const":"warmth"},"value":{"type":"string","enum":["reserved","neutral","warm"]}},"required":["key","value"],"additionalProperties":false},{"type":"object","properties":{"key":{"type":"string","const":"help_offer"},"value":{"type":"string","enum":["none","natural"]}},"required":["key","value"],"additionalProperties":false}]}},"preferenceRevisions":{"maxItems":8,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}},"policyRevision":{"anyOf":[{"type":"string","pattern":"^[a-f0-9]{32}$"},{"type":"null"}]},"policySettings":{"anyOf":[{"type":"object","properties":{"schemaVersion":{"type":"number","const":1},"blockedSenders":{"maxItems":50,"type":"array","items":{"type":"string","maxLength":254}},"blockedDomains":{"maxItems":50,"type":"array","items":{"type":"string","maxLength":253}},"blockedCategories":{"maxItems":10,"type":"array","items":{"type":"string","enum":["REQUEST_INFORMATION","REQUEST_ACTION","CONFIRMATION","FOLLOW_UP","MEETING","COMPLAINT","FINANCIAL","LEGAL_CONTRACT","NOTIFICATION","UNKNOWN"]}},"blockedTopics":{"maxItems":30,"type":"array","items":{"type":"string","minLength":1,"maxLength":80}},"sourceRequirements":{"maxItems":5,"type":"array","items":{"type":"object","properties":{"kind":{"type":"string","enum":["PRICE","DEADLINE","HOURS","PROCEDURE","FACT"]},"sourceIds":{"minItems":1,"maxItems":20,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}}},"required":["kind","sourceIds"],"additionalProperties":false}}},"required":["schemaVersion","blockedSenders","blockedDomains","blockedCategories","blockedTopics","sourceRequirements"],"additionalProperties":false},{"type":"null"}]},"knowledgeRevision":{"anyOf":[{"type":"string","pattern":"^[a-f0-9]{32}$"},{"type":"null"}]},"sourceRuleIds":{"maxItems":200,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}},"consultedSourceIds":{"maxItems":200,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}},"knowledgeFragments":{"maxItems":8,"type":"array","items":{"type":"object","properties":{"sourceId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"documentId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"chunkId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"version":{"type":"integer","minimum":1,"maximum":2147483647}},"required":["sourceId","documentId","chunkId","version"],"additionalProperties":false}},"examplesUsed":{"type":"integer","minimum":0,"maximum":3},"allowEmailHistory":{"type":"boolean"},"allowPartialDrafts":{"type":"boolean"},"userInstructionsHash":{"anyOf":[{"type":"string","pattern":"^[a-f0-9]{64}$"},{"type":"null"}]}},"required":["version","promptVersion","securityVersion","responseSchemaVersion","reasoningEffort","maxOutputTokens","styleRevision","style","preferences","preferenceRevisions","policyRevision","policySettings","knowledgeRevision","sourceRuleIds","consultedSourceIds","knowledgeFragments","examplesUsed","allowEmailHistory","allowPartialDrafts","userInstructionsHash"],"additionalProperties":false}'::json,configuration)),
  input_tokens integer check(input_tokens>=0),
  output_tokens integer check(output_tokens>=0),
  model_calls integer check(model_calls between 0 and 20),
  duration_ms integer not null check(duration_ms>=0),
  estimated_cost_usd numeric(20,8) check(estimated_cost_usd>=0),
  pricing jsonb check(pricing is null or extensions.jsonb_matches_schema('{
    "type":"object","additionalProperties":false,"required":["inputUsdPerMillion","outputUsdPerMillion","currency","method"],
    "properties":{"inputUsdPerMillion":{"type":"number","minimum":0,"maximum":1000000},"outputUsdPerMillion":{"type":"number","minimum":0,"maximum":1000000},"currency":{"const":"USD"},"method":{"const":"uncached_upper_estimate"}}
  }'::json,pricing)),
  sources_used jsonb not null default '[]' check(public.valid_reply_sources(sources_used)),
  warnings text[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  unique(id,user_id,gmail_account_id),
  unique(gmail_account_id,target_message_id,generation_version),
  foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  foreign key(email_job_id,user_id,gmail_account_id) references public.email_jobs(id,user_id,gmail_account_id) on delete cascade,
  check((status='FAILED' and input_tokens is null and output_tokens is null and model_calls is null) or
    (status<>'FAILED' and input_tokens is not null and output_tokens is not null and model_calls is not null)),
  check((estimated_cost_usd is null)=(pricing is null or input_tokens is null or output_tokens is null))
);
create index generation_runs_owner_period_idx on public.generation_runs(user_id,created_at desc);
create index generation_runs_account_owner_idx on public.generation_runs(gmail_account_id,user_id);
create index generation_runs_job_owner_idx on public.generation_runs(email_job_id,user_id,gmail_account_id);
alter table public.generation_runs enable row level security;
revoke all on public.generation_runs from public,anon,authenticated;
grant select on public.generation_runs to authenticated;
grant select,insert,delete on public.generation_runs to service_role;
create policy generation_runs_select_own on public.generation_runs for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.users u where u.id=(select auth.uid()) and u.status='ACTIVE')
  and exists(select 1 from public.gmail_accounts a where a.id=gmail_account_id and a.user_id=(select auth.uid()) and a.status='CONNECTED')
);

alter table public.draft_generations add column generation_run_id uuid unique,
  add constraint draft_generations_generation_run_owner_fk foreign key(generation_run_id,user_id,gmail_account_id)
    references public.generation_runs(id,user_id,gmail_account_id);
grant select(generation_run_id) on public.draft_generations to authenticated;

create table public.generation_content_authorizations (
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid primary key,
  retention_hours integer not null check(retention_hours between 1 and 168),
  notice_version text not null check(notice_version='mail056-v1'),
  authorized_at timestamptz not null default clock_timestamp(),
  foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade
);
create index generation_content_authorizations_owner_idx on public.generation_content_authorizations(user_id);
alter table public.generation_content_authorizations enable row level security;
revoke all on public.generation_content_authorizations from public,anon,authenticated;
grant select,insert,update,delete on public.generation_content_authorizations to service_role;
create table public.generation_temporary_content (
  generation_run_id uuid primary key,
  user_id uuid not null,
  gmail_account_id uuid not null references public.generation_content_authorizations(gmail_account_id) on delete cascade,
  body_text text not null check(char_length(body_text) between 1 and 6000),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key(generation_run_id,user_id,gmail_account_id) references public.generation_runs(id,user_id,gmail_account_id) on delete cascade,
  check(expires_at>created_at and expires_at<=created_at+interval '7 days')
);
create index generation_temporary_content_expiry_idx on public.generation_temporary_content(expires_at);
create index generation_temporary_content_owner_idx on public.generation_temporary_content(generation_run_id,user_id,gmail_account_id);
create index generation_temporary_content_account_idx on public.generation_temporary_content(gmail_account_id);
alter table public.generation_temporary_content enable row level security;
revoke all on public.generation_temporary_content from public,anon,authenticated;
grant select,insert,update,delete on public.generation_temporary_content to service_role;

create function public.record_generation_run(
  p_id uuid,p_user_id uuid,p_account_id uuid,p_thread_id text,p_target_message_id text,p_model text,p_status text,
  p_configuration jsonb,p_duration_ms integer,p_sources_used jsonb,p_warnings text[],p_pricing jsonb,
  p_job_id uuid default null,p_input_tokens integer default null,p_output_tokens integer default null,p_model_calls integer default null,
  p_estimated_cost_usd numeric default null,p_body_text text default null
) returns void language plpgsql security invoker set search_path='' as $$
declare next_version integer; retention integer; stamp timestamptz;
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  -- Serializes numbering, consent withdrawal, disconnect and content insertion.
  perform 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_job_id is not null and not exists(select 1 from public.email_jobs where id=p_job_id and user_id=p_user_id and gmail_account_id=p_account_id
    and thread_id=p_thread_id and target_message_id=p_target_message_id) then raise exception 'FORBIDDEN'; end if;
  select coalesce(max(generation_version),0)+1 into next_version from public.generation_runs where gmail_account_id=p_account_id and target_message_id=p_target_message_id;
  insert into public.generation_runs(id,user_id,gmail_account_id,email_job_id,thread_id,target_message_id,generation_version,status,model,configuration,
    input_tokens,output_tokens,model_calls,duration_ms,estimated_cost_usd,pricing,sources_used,warnings)
  values(p_id,p_user_id,p_account_id,p_job_id,p_thread_id,p_target_message_id,next_version,p_status,p_model,p_configuration,
    p_input_tokens,p_output_tokens,p_model_calls,p_duration_ms,p_estimated_cost_usd,p_pricing,p_sources_used,p_warnings);
  select retention_hours into retention from public.generation_content_authorizations where gmail_account_id=p_account_id and user_id=p_user_id;
  if retention is not null and p_status in ('READY','PARTIAL') and p_body_text is not null then
    stamp:=clock_timestamp();
    insert into public.generation_temporary_content(generation_run_id,user_id,gmail_account_id,body_text,created_at,expires_at)
    values(p_id,p_user_id,p_account_id,p_body_text,stamp,stamp+make_interval(hours=>retention));
  end if;
end;
$$;
create function public.guard_generation_run_reference() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.generation_run_id is distinct from old.generation_run_id then raise exception 'GENERATION_IMMUTABLE'; end if;
  if new.generation_run_id is not null and not exists(select 1 from public.generation_runs r where r.id=new.generation_run_id
    and r.user_id=new.user_id and r.gmail_account_id=new.gmail_account_id and r.thread_id=new.thread_id and r.target_message_id=new.target_message_id
    and r.status='READY' and r.model=new.model and r.configuration->>'styleRevision'=new.style_revision::text
    and r.configuration->>'promptVersion'=new.prompt_version and r.input_tokens=new.input_tokens and r.output_tokens=new.output_tokens
    and r.email_job_id is not distinct from new.email_job_id) then raise exception 'INVALID_GENERATION_REFERENCE'; end if;
  return new;
end;
$$;
create trigger draft_generation_run_guard before insert or update of generation_run_id on public.draft_generations
  for each row execute function public.guard_generation_run_reference();

create function public.set_generation_retention(p_user_id uuid,p_account_id uuid,p_enabled boolean,p_retention_hours integer default null,p_notice_version text default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_enabled then
    if p_retention_hours is null or p_retention_hours not between 1 and 168 or p_notice_version is distinct from 'mail056-v1' then raise exception 'INVALID_INPUT'; end if;
    insert into public.generation_content_authorizations(user_id,gmail_account_id,retention_hours,notice_version)
      values(p_user_id,p_account_id,p_retention_hours,p_notice_version)
      on conflict(gmail_account_id) do update set retention_hours=excluded.retention_hours,notice_version=excluded.notice_version,authorized_at=clock_timestamp();
    -- Reducing retention shortens existing copies; an extension never prolongs them.
    delete from public.generation_temporary_content where gmail_account_id=p_account_id and created_at+make_interval(hours=>p_retention_hours)<=clock_timestamp();
    update public.generation_temporary_content set expires_at=least(expires_at,created_at+make_interval(hours=>p_retention_hours)) where gmail_account_id=p_account_id;
  else
    delete from public.generation_content_authorizations where gmail_account_id=p_account_id and user_id=p_user_id;
  end if;
end;
$$;
create function public.purge_generation_content() returns void language sql security invoker set search_path='' as $$
  delete from public.generation_temporary_content where expires_at<=clock_timestamp();
$$;
create function public.read_generation_content(p_user_id uuid,p_generation_run_id uuid) returns text language sql security invoker set search_path='' as $$
  select c.body_text from public.generation_temporary_content c
  join public.generation_content_authorizations a on a.gmail_account_id=c.gmail_account_id and a.user_id=c.user_id
  join public.gmail_accounts g on g.id=c.gmail_account_id and g.user_id=c.user_id
  join public.users u on u.id=c.user_id
  where c.user_id=p_user_id and c.generation_run_id=p_generation_run_id and c.expires_at>clock_timestamp() and u.status='ACTIVE' and g.status='CONNECTED';
$$;
create function public.revoke_generation_content() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='users' then
    if new.status<>'ACTIVE' then delete from public.generation_content_authorizations where user_id=new.id; end if;
  elsif new.status<>'CONNECTED' then
    delete from public.generation_content_authorizations where gmail_account_id=new.id;
  end if;
  return new;
end;
$$;
create trigger gmail_revoke_generation_content after update of status on public.gmail_accounts for each row execute function public.revoke_generation_content();
create trigger user_revoke_generation_content after update of status on public.users for each row execute function public.revoke_generation_content();
revoke all on function public.record_generation_run(uuid,uuid,uuid,text,text,text,text,jsonb,integer,jsonb,text[],jsonb,uuid,integer,integer,integer,numeric,text),
  public.guard_generation_run_reference(),public.set_generation_retention(uuid,uuid,boolean,integer,text),public.purge_generation_content(),
  public.read_generation_content(uuid,uuid),public.revoke_generation_content() from public,anon,authenticated;
grant execute on function public.record_generation_run(uuid,uuid,uuid,text,text,text,text,jsonb,integer,jsonb,text[],jsonb,uuid,integer,integer,integer,numeric,text),
  public.guard_generation_run_reference(),public.set_generation_retention(uuid,uuid,boolean,integer,text),public.purge_generation_content(),
  public.read_generation_content(uuid,uuid),public.revoke_generation_content() to service_role;

create extension if not exists pg_cron;
select cron.schedule('mail056-purge-generation-content','*/5 * * * *','select public.purge_generation_content()');
