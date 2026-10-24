alter table public.source_documents
  add column audience_kind text not null default 'GENERAL',
  add column audience_key text not null default '',
  add constraint source_documents_audience_check check (
    (audience_kind='GENERAL' and audience_key='') or
    (audience_kind='RECIPIENT' and char_length(audience_key) between 3 and 254
      and audience_key=lower(audience_key) and audience_key ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$') or
    (audience_kind='DOMAIN' and char_length(audience_key) between 3 and 253
      and audience_key=lower(audience_key) and audience_key ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')
  );

create function public.set_document_audience(p_user_id uuid,p_document_id uuid,p_kind text,p_key text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  update public.source_documents set audience_kind=p_kind,audience_key=lower(p_key)
    where id=p_document_id and user_id=p_user_id and status='READY';
  return found;
end;
$$;
revoke all on function public.set_document_audience(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_document_audience(uuid,uuid,text,text) to service_role;

create function public.valid_factual_validation(p_value jsonb) returns boolean
language plpgsql immutable strict security invoker set search_path='' as $$
begin
  if not extensions.jsonb_matches_schema('{
    "type":"object","additionalProperties":false,
    "required":["version","status","bodyHash","contextHash","recipientHash","evidenceHash","claimCount","issues"],
    "properties":{
      "version":{"const":"mail046-v1"},"status":{"enum":["SUPPORTED","REVIEW_REQUIRED"]},
      "bodyHash":{"type":"string","pattern":"^[a-f0-9]{64}$"},
      "contextHash":{"type":"string","pattern":"^[a-f0-9]{64}$"},
      "recipientHash":{"type":"string","pattern":"^[a-f0-9]{64}$"},
      "evidenceHash":{"type":"string","pattern":"^[a-f0-9]{64}$"},
      "claimCount":{"type":"integer","minimum":0,"maximum":6000},
      "issues":{"type":"array","maxItems":32,"items":{
        "type":"object","additionalProperties":false,"required":["claimIndex","kind","reason","start","end"],
        "properties":{
          "claimIndex":{"type":"integer","minimum":0,"maximum":5999},
          "kind":{"enum":["AMOUNT","DATE","QUANTITY","CONDITION","COMMITMENT","FACT"]},
          "reason":{"enum":["MISSING_EVIDENCE","INVALID_CITATION","VALUE_MISMATCH","CONDITION_MISMATCH","TOPIC_MISMATCH","RECIPIENT_MISMATCH","SOURCE_NOT_CURRENT","UNAUTHORIZED_COMMITMENT","SEMANTIC_REJECTION","VALIDATION_CHANGED","INVALID_VALUE","AMBIGUOUS_DATE"]},
          "start":{"type":"integer","minimum":0,"maximum":5999},"end":{"type":"integer","minimum":1,"maximum":6000}
        }
      }}
    }
  }'::json,p_value) then return false; end if;
  return ((p_value->>'status'='SUPPORTED')=(jsonb_array_length(p_value->'issues')=0))
    and not exists(select 1 from jsonb_array_elements(p_value->'issues') i
      where (i->>'end')::integer<=(i->>'start')::integer
        or (i->>'claimIndex')::integer>=(p_value->>'claimCount')::integer);
end;
$$;
revoke all on function public.valid_factual_validation(jsonb) from public,anon;
grant execute on function public.valid_factual_validation(jsonb) to authenticated,service_role;

create table public.response_validation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  evaluation_id uuid not null unique,
  thread_id text not null check(char_length(thread_id) between 1 and 512 and thread_id ~ '^[A-Za-z0-9_-]+$'),
  target_message_id text not null check(char_length(target_message_id) between 1 and 512 and target_message_id ~ '^[A-Za-z0-9_-]+$'),
  validation jsonb not null check(octet_length(validation::text)<=16384 and public.valid_factual_validation(validation)),
  created_at timestamptz not null default now(),
  constraint response_validation_events_account_owner_fkey foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade
);
create index response_validation_events_owner_created_idx on public.response_validation_events(user_id,created_at desc);
create index response_validation_events_account_owner_idx on public.response_validation_events(gmail_account_id,user_id);
alter table public.response_validation_events enable row level security;
revoke all on public.response_validation_events from public,anon,authenticated;
grant select on public.response_validation_events to authenticated;
grant select,insert on public.response_validation_events to service_role;
create policy response_validation_events_select_own on public.response_validation_events for select to authenticated using (
  (select auth.uid())=user_id
  and exists(select 1 from public.users u where u.id=(select auth.uid()) and u.status='ACTIVE')
  and exists(select 1 from public.gmail_accounts a where a.id=gmail_account_id and a.user_id=(select auth.uid()) and a.status='CONNECTED')
);
alter table public.draft_generations add column factual_validation jsonb,
  add constraint draft_generations_factual_validation_check check (factual_validation is null or (
    octet_length(factual_validation::text)<=16384 and public.valid_factual_validation(factual_validation) and factual_validation->>'status'='SUPPORTED'
  ));
create or replace function public.get_knowledge_source_configuration(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  with config as (
    select jsonb_build_object(
      'allowPartialDrafts',coalesce((select s.allow_partial_knowledge_drafts from public.user_settings s where s.user_id=p_user_id),false),
      'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'priority',s.priority,'enabled',s.enabled) order by s.priority,s.id)
        from public.knowledge_sources s where s.user_id=p_user_id),'[]'::jsonb),
      'rules',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'intent',r.intent_key,'terms',r.terms,
        'priority',r.priority,'enabled',r.enabled,'allowEmailHistory',r.allow_email_history,
        'primarySourceIds',coalesce((select jsonb_agg(l.source_id order by l.ordinal) from public.source_rule_sources l where l.rule_id=r.id and l.user_id=p_user_id and l.role='PRIMARY'),'[]'::jsonb),
        'fallbackSourceIds',coalesce((select jsonb_agg(l.source_id order by l.ordinal) from public.source_rule_sources l where l.rule_id=r.id and l.user_id=p_user_id and l.role='FALLBACK'),'[]'::jsonb),
        'excludedSourceIds',coalesce((select jsonb_agg(l.source_id order by l.ordinal) from public.source_rule_sources l where l.rule_id=r.id and l.user_id=p_user_id and l.role='EXCLUDED'),'[]'::jsonb)) order by r.priority,r.id)
        from public.source_rules r where r.user_id=p_user_id),'[]'::jsonb)
    ) as value
    where exists(select 1 from public.users where id=p_user_id and status='ACTIVE')
  ) select value || jsonb_build_object('revision',md5(value::text || coalesce((
    select jsonb_agg(jsonb_build_array(d.id,d.source_id,d.version,d.status,d.content_updated_at,d.valid_from,d.valid_until,d.index_hash,d.indexed_at,d.audience_kind,d.audience_key) order by d.id)::text
    from public.source_documents d where d.user_id=p_user_id),'[]'))) from config;
$$;
create function public.search_knowledge_context_chunks(p_user_id uuid,p_query text,p_source_ids uuid[],p_revision text,p_limit integer,p_recipient text)
returns table(source_id uuid,source_title text,chunk_id uuid,document_id uuid,document_name text,version integer,"position" integer,
  section text,content text,start_offset integer,end_offset integer,page_start integer,page_end integer,rank real,
  document_updated_at timestamptz,valid_from date,valid_until date,audience_kind text,audience_key text)
language plpgsql stable security invoker set search_path='' as $$
declare terms tsquery;
begin
  if p_query is null or char_length(btrim(p_query)) not between 1 and 300 or p_limit is null or p_limit not between 1 and 20
    or p_source_ids is null or cardinality(p_source_ids)>20 or array_position(p_source_ids,null) is not null then raise exception 'INVALID_KNOWLEDGE_QUERY'; end if;
  if p_revision is null or (public.get_knowledge_source_configuration(p_user_id)->>'revision') is distinct from p_revision then raise exception 'SOURCE_CONFIGURATION_CHANGED'; end if;
  if cardinality(p_source_ids)=0 then return; end if;
  terms := websearch_to_tsquery('spanish'::regconfig,p_query) || websearch_to_tsquery('simple'::regconfig,p_query);
  if numnode(terms)=0 or querytree(terms) in ('','T') then return; end if;
  return query with candidates as (
    select s.id as sid,s.title,c.id as cid,c.document_id,d.name,c.version,c.position,c.section,c.content,
      c.start_offset,c.end_offset,c.page_start,c.page_end,ts_rank_cd(c.search_vector,terms,32) as relevance,
      d.content_updated_at,d.valid_from,d.valid_until,d.audience_kind,d.audience_key,
      row_number() over(partition by c.document_id order by ts_rank_cd(c.search_vector,terms,32) desc,c.position) as doc_rank
    from public.knowledge_chunks c
    join public.source_documents d on d.id=c.document_id and d.user_id=c.user_id and d.version=c.version
    join public.knowledge_sources s on s.id=d.source_id and s.user_id=d.user_id and s.enabled
    join public.users u on u.id=d.user_id and u.status='ACTIVE'
    where c.user_id=p_user_id and s.id=any(p_source_ids) and d.status='READY' and d.indexed_at is not null and c.search_vector @@ terms
      and (d.audience_kind='GENERAL' or (d.audience_kind='RECIPIENT' and d.audience_key=lower(p_recipient)) or (d.audience_kind='DOMAIN' and d.audience_key=split_part(lower(p_recipient),'@',2)))
  ) select t.sid,t.title,t.cid,t.document_id,t.name,t.version,t.position,t.section,t.content,t.start_offset,t.end_offset,
      t.page_start,t.page_end,t.relevance,t.content_updated_at,t.valid_from,t.valid_until,t.audience_kind,t.audience_key
    from candidates t where t.doc_rank<=2
    order by t.relevance desc,t.content_updated_at desc,t.document_id,t.position limit p_limit;
end;
$$;

create or replace function public.search_knowledge_context_chunks(p_user_id uuid,p_query text,p_source_ids uuid[],p_revision text,p_limit integer default 20)
returns table(source_id uuid,source_title text,chunk_id uuid,document_id uuid,document_name text,version integer,"position" integer,
  section text,content text,start_offset integer,end_offset integer,page_start integer,page_end integer,rank real,
  document_updated_at timestamptz,valid_from date,valid_until date)
language sql stable security invoker set search_path='' as $$
  select t.source_id,t.source_title,t.chunk_id,t.document_id,t.document_name,t.version,t.position,t.section,t.content,
    t.start_offset,t.end_offset,t.page_start,t.page_end,t.rank,t.document_updated_at,t.valid_from,t.valid_until
  from public.search_knowledge_context_chunks(p_user_id,p_query,p_source_ids,p_revision,p_limit,''::text) t;
$$;
revoke all on function public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer,text) from public,anon,authenticated;
grant execute on function public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer,text) to service_role;

alter table public.draft_generations drop constraint draft_generations_prompt_version_check,
  add constraint draft_generations_prompt_version_check check (prompt_version in (
    'mail020-v1', 'mail020-v2', 'mail027-v1', 'mail028-v1', 'mail028-v2',
    'mail039-v1', 'mail040-v1', 'mail041-v1', 'epic06-v1', 'mail043-v1', 'mail046-v1'
  ));
