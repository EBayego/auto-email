create function public.valid_response_policy(p_settings jsonb) returns boolean
language plpgsql immutable strict security invoker set search_path='' as $$
begin
  if not extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"schemaVersion":{"type":"number","const":1},"blockedSenders":{"maxItems":50,"type":"array","items":{"type":"string","maxLength":254},"uniqueItems":true},"blockedDomains":{"maxItems":50,"type":"array","items":{"type":"string","maxLength":253},"uniqueItems":true},"blockedCategories":{"maxItems":10,"type":"array","items":{"type":"string","enum":["REQUEST_INFORMATION","REQUEST_ACTION","CONFIRMATION","FOLLOW_UP","MEETING","COMPLAINT","FINANCIAL","LEGAL_CONTRACT","NOTIFICATION","UNKNOWN"]},"uniqueItems":true},"blockedTopics":{"maxItems":30,"type":"array","items":{"type":"string","minLength":1,"maxLength":80},"uniqueItems":true},"sourceRequirements":{"maxItems":5,"type":"array","items":{"type":"object","properties":{"kind":{"type":"string","enum":["PRICE","DEADLINE","HOURS","PROCEDURE","FACT"]},"sourceIds":{"minItems":1,"maxItems":20,"type":"array","items":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"uniqueItems":true}},"required":["kind","sourceIds"],"additionalProperties":false},"uniqueItems":true}},"required":["schemaVersion","blockedSenders","blockedDomains","blockedCategories","blockedTopics","sourceRequirements"],"additionalProperties":false}'::json,p_settings) then return false; end if;
  return (select count(*)=count(distinct value->>'kind') from jsonb_array_elements(p_settings->'sourceRequirements'));
end;
$$;
revoke all on function public.valid_response_policy(jsonb) from public,anon;
grant execute on function public.valid_response_policy(jsonb) to authenticated,service_role;
alter table public.user_settings add column response_policy jsonb not null default '{"schemaVersion":1,"blockedSenders":[],"blockedDomains":[],"blockedCategories":[],"blockedTopics":[],"sourceRequirements":[]}'::jsonb,
  add constraint user_settings_response_policy_check check (octet_length(response_policy::text)<=65536 and public.valid_response_policy(response_policy));
grant select(response_policy) on public.user_settings to authenticated;

create function public.get_response_policy(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('settings',s.response_policy,'revision',md5(s.response_policy::text))
  from public.user_settings s join public.users u on u.id=s.user_id where s.user_id=p_user_id and u.status='ACTIVE';
$$;
create function public.set_response_policy(p_user_id uuid,p_settings jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  if p_settings is null or octet_length(p_settings::text)>65536 or not public.valid_response_policy(p_settings) then
    raise exception 'INVALID_RESPONSE_POLICY' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements(p_settings->'sourceRequirements') r,
    jsonb_array_elements_text(r->'sourceIds') source_id where not exists(
      select 1 from public.knowledge_sources s where s.id=source_id::uuid and s.user_id=p_user_id)) then
    raise exception 'INVALID_RESPONSE_POLICY_SOURCE' using errcode='23514';
  end if;
  update public.user_settings set response_policy=p_settings where user_id=p_user_id;
  return found;
end;
$$;
revoke all on function public.get_response_policy(uuid),public.set_response_policy(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.get_response_policy(uuid),public.set_response_policy(uuid,jsonb) to service_role;

create function public.valid_response_policy_evaluation(p_value jsonb) returns boolean
language sql immutable strict security invoker set search_path='' as $$
  select extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"version":{"type":"string","const":"mail045-v1"},"phase":{"type":"string","enum":["PREFLIGHT","POSTFLIGHT"]},"action":{"type":"string","enum":["ALLOW_DRAFT","REVIEW_REQUIRED","BLOCK"]},"reasons":{"maxItems":13,"type":"array","items":{"type":"string","enum":["SENDER_BLOCKED","CATEGORY_BLOCKED","TOPIC_BLOCKED","POLICY_CONTEXT_REQUIRED","PAYMENT_REQUIRES_REVIEW","CONTRACT_REQUIRES_REVIEW","DISCOUNT_REQUIRES_REVIEW","SENSITIVE_CATEGORY","PROMPT_INJECTION","REQUIRED_SOURCE_MISSING","UNVERIFIED_DEADLINE","UNVERIFIED_COMMITMENT","POLICY_CHANGED"]},"uniqueItems":true}},"required":["version","phase","action","reasons"],"additionalProperties":false}'::json,p_value);
$$;
revoke all on function public.valid_response_policy_evaluation(jsonb) from public,anon,authenticated;
grant execute on function public.valid_response_policy_evaluation(jsonb) to service_role;
create table public.response_policy_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  evaluation_id uuid not null,
  thread_id text not null check(char_length(thread_id) between 1 and 512 and thread_id ~ '^[A-Za-z0-9_-]+$'),
  target_message_id text not null check(char_length(target_message_id) between 1 and 512 and target_message_id ~ '^[A-Za-z0-9_-]+$'),
  policy_revision text not null check(policy_revision ~ '^[a-f0-9]{32}$'),
  engine_version text not null,
  phase text not null,
  action text not null,
  reasons text[] not null,
  created_at timestamptz not null default now(),
  constraint response_policy_events_account_owner_fkey foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  unique(evaluation_id,phase),
  check(public.valid_response_policy_evaluation(jsonb_build_object('version',engine_version,'phase',phase,'action',action,'reasons',reasons))),
  check((action='ALLOW_DRAFT')=(cardinality(reasons)=0))
);
create index response_policy_events_owner_created_idx on public.response_policy_events(user_id,created_at desc);
create index response_policy_events_account_owner_idx on public.response_policy_events(gmail_account_id,user_id);
alter table public.response_policy_events enable row level security;
revoke all on public.response_policy_events from public,anon,authenticated;
grant select on public.response_policy_events to authenticated;
grant select,insert on public.response_policy_events to service_role;
create policy response_policy_events_select_own on public.response_policy_events for select to authenticated using(
  (select auth.uid())=user_id
  and exists(select 1 from public.users u where u.id=(select auth.uid()) and u.status='ACTIVE')
  and exists(select 1 from public.gmail_accounts a where a.id=gmail_account_id and a.user_id=(select auth.uid()) and a.status='CONNECTED')
);
alter table public.draft_generations add column policy_revision text check(policy_revision ~ '^[a-f0-9]{32}$');

create or replace function public.begin_draft_write(
  p_user_id uuid, p_account_id uuid, p_attempt_id uuid, p_thread_id text,
  p_target_message_id text, p_job_id uuid default null, p_lease_id uuid default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare daily_limit integer; generated_revision text; current_revision text;
begin
  if (p_job_id is null) <> (p_lease_id is null) then return false; end if;
  if p_job_id is not null then
    perform 1 from public.email_jobs j
      where j.id = p_job_id and j.user_id = p_user_id and j.gmail_account_id = p_account_id
        and j.thread_id = p_thread_id and j.target_message_id = p_target_message_id
        and j.status = 'GENERATING' and j.lease_id = p_lease_id
        and j.lease_expires_at > clock_timestamp()
        and public.gmail_execution_allowed(p_user_id,p_account_id)
      for update of j;
    if not found then return false; end if;
  end if;
  -- Serialize quota allocation for every account belonging to this user.
  select s.max_daily_drafts,md5(s.response_policy::text) into daily_limit,current_revision from public.user_settings s where s.user_id=p_user_id for update;
  if not found then return false; end if;
  perform 1 from public.draft_generations d where d.id=p_attempt_id and d.user_id=p_user_id
    and d.gmail_account_id=p_account_id and d.thread_id=p_thread_id and d.target_message_id=p_target_message_id
    and d.status='CREATING' and d.write_started_at is null for update;
  if not found then return false; end if;
  select d.policy_revision into generated_revision from public.draft_generations d where d.id=p_attempt_id;
  if not exists(select 1 from public.users where id=p_user_id and status='ACTIVE') then return false; end if;
  if generated_revision is not null and generated_revision is distinct from current_revision then
    insert into public.response_policy_events(user_id,gmail_account_id,evaluation_id,thread_id,target_message_id,policy_revision,engine_version,phase,action,reasons)
      values(p_user_id,p_account_id,gen_random_uuid(),p_thread_id,p_target_message_id,current_revision,'mail045-v1','POSTFLIGHT','REVIEW_REQUIRED',array['POLICY_CHANGED']);
    return false;
  end if;
  if public.daily_draft_usage(p_user_id)>=daily_limit then raise exception 'DAILY_DRAFT_LIMIT'; end if;
  update public.draft_generations d set write_started_at = clock_timestamp()
    where d.id = p_attempt_id and d.user_id = p_user_id and d.gmail_account_id = p_account_id
      and d.thread_id = p_thread_id and d.target_message_id = p_target_message_id
      and d.status = 'CREATING' and d.write_started_at is null
      and exists(select 1 from public.users u where u.id = p_user_id and u.status = 'ACTIVE')
      and exists(select 1 from public.gmail_accounts a where a.id = p_account_id and a.user_id = p_user_id and a.status = 'CONNECTED')
      -- Locks and quota allocation can outlive the initial checks. Re-read
      -- execution controls and the lease at the actual write authorization.
      and (p_job_id is null or (
        public.gmail_execution_allowed(p_user_id,p_account_id)
        and exists(select 1 from public.email_jobs j where j.id=p_job_id and j.user_id=p_user_id
          and j.gmail_account_id=p_account_id and j.thread_id=p_thread_id and j.target_message_id=p_target_message_id
          and j.status='GENERATING' and j.lease_id=p_lease_id and j.lease_expires_at>clock_timestamp())
      ));
  return found;
end;
$$;
