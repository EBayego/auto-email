create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100 and title !~ '[[:cntrl:]]'),
  priority integer not null default 100 check (priority between 0 and 1000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id)
);
create unique index knowledge_sources_owner_title_idx on public.knowledge_sources(user_id,lower(btrim(title)));
create trigger knowledge_sources_updated_at before update on public.knowledge_sources for each row execute function public.touch_updated_at();
alter table public.source_documents add column source_id uuid,
  add constraint source_documents_source_owner_fk foreign key (source_id,user_id) references public.knowledge_sources(id,user_id);
create index source_documents_source_owner_idx on public.source_documents(source_id,user_id);

create table public.source_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100 and title !~ '[[:cntrl:]]'),
  intent_key text not null check (intent_key in ('*','REQUEST_INFORMATION','REQUEST_ACTION','CONFIRMATION','FOLLOW_UP','MEETING','COMPLAINT','FINANCIAL','LEGAL_CONTRACT','NOTIFICATION','UNKNOWN')),
  terms text[] not null default '{}',
  priority integer not null default 100 check (priority between 0 and 1000),
  enabled boolean not null default true,
  allow_email_history boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id),
  check (cardinality(terms) <= 10 and array_position(terms,null) is null and octet_length(terms::text) <= 3000)
);
create index source_rules_owner_idx on public.source_rules(user_id,priority);
create trigger source_rules_updated_at before update on public.source_rules for each row execute function public.touch_updated_at();
create table public.source_rule_sources (
  rule_id uuid not null,
  user_id uuid not null,
  source_id uuid not null,
  role text not null check (role in ('PRIMARY','FALLBACK','EXCLUDED')),
  ordinal integer not null check (ordinal between 0 and 19),
  primary key(rule_id,source_id),
  unique(rule_id,role,ordinal),
  foreign key(rule_id,user_id) references public.source_rules(id,user_id) on delete cascade,
  foreign key(source_id,user_id) references public.knowledge_sources(id,user_id)
);
create index source_rule_sources_owner_idx on public.source_rule_sources(user_id,rule_id);
create index source_rule_sources_source_idx on public.source_rule_sources(source_id,user_id);
alter table public.knowledge_sources enable row level security;
alter table public.source_rules enable row level security;
alter table public.source_rule_sources enable row level security;
revoke all on public.knowledge_sources,public.source_rules,public.source_rule_sources from anon,authenticated;
grant select on public.knowledge_sources,public.source_rules,public.source_rule_sources to authenticated;
grant select,insert,update,delete on public.knowledge_sources,public.source_rules,public.source_rule_sources to service_role;
create policy knowledge_sources_select_own on public.knowledge_sources for select to authenticated using (
  user_id = (select auth.uid()) and exists(select 1 from public.users where id=(select auth.uid()) and status='ACTIVE')
);
create policy source_rules_select_own on public.source_rules for select to authenticated using (
  user_id = (select auth.uid()) and exists(select 1 from public.users where id=(select auth.uid()) and status='ACTIVE')
);
create policy source_rule_sources_select_own on public.source_rule_sources for select to authenticated using (
  user_id = (select auth.uid()) and exists(select 1 from public.users where id=(select auth.uid()) and status='ACTIVE')
);

create function public.save_knowledge_source(p_user_id uuid,p_title text,p_priority integer,p_enabled boolean,p_source_id uuid default null)
returns public.knowledge_sources language plpgsql security invoker set search_path='' as $$
declare result public.knowledge_sources;
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'SOURCE_OWNER_UNAVAILABLE'; end if;
  if p_source_id is null then
    if (select count(*) from public.knowledge_sources where user_id=p_user_id)>=20 then raise exception 'SOURCE_LIMIT'; end if;
    insert into public.knowledge_sources(user_id,title,priority,enabled) values(p_user_id,btrim(p_title),p_priority,p_enabled) returning * into result;
  else
    update public.knowledge_sources set title=btrim(p_title),priority=p_priority,enabled=p_enabled where id=p_source_id and user_id=p_user_id returning * into result;
    if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  end if;
  return result;
end;
$$;
create function public.save_source_rule(p_user_id uuid,p_title text,p_intent text,p_terms text[],p_priority integer,
  p_enabled boolean,p_allow_email_history boolean,p_primary_ids uuid[],p_fallback_ids uuid[],p_excluded_ids uuid[],p_rule_id uuid default null)
returns public.source_rules language plpgsql security invoker set search_path='' as $$
declare result public.source_rules; ids uuid[];
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'SOURCE_OWNER_UNAVAILABLE'; end if;
  if p_primary_ids is null or p_fallback_ids is null or p_excluded_ids is null
    or cardinality(p_primary_ids) not between 1 and 20 or cardinality(p_fallback_ids)>20 or cardinality(p_excluded_ids)>20 then
    raise exception 'INVALID_SOURCE_RULE';
  end if;
  ids := p_primary_ids || p_fallback_ids || p_excluded_ids;
  if array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'INVALID_SOURCE_RULE'; end if;
  if (select count(*) from public.knowledge_sources where user_id=p_user_id and id=any(ids))<>cardinality(ids) then raise exception 'SOURCE_NOT_FOUND'; end if;
  if exists(select 1 from unnest(p_terms) term where char_length(btrim(term)) not between 1 and 60 or term ~ '[[:cntrl:]]') then raise exception 'INVALID_SOURCE_RULE'; end if;
  if p_rule_id is null then
    if (select count(*) from public.source_rules where user_id=p_user_id)>=50 then raise exception 'RULE_LIMIT'; end if;
    insert into public.source_rules(user_id,title,intent_key,terms,priority,enabled,allow_email_history)
      values(p_user_id,btrim(p_title),p_intent,p_terms,p_priority,p_enabled,p_allow_email_history) returning * into result;
  else
    update public.source_rules set title=btrim(p_title),intent_key=p_intent,terms=p_terms,priority=p_priority,enabled=p_enabled,allow_email_history=p_allow_email_history
      where id=p_rule_id and user_id=p_user_id returning * into result;
    if not found then raise exception 'SOURCE_NOT_FOUND'; end if;
  end if;
  delete from public.source_rule_sources where rule_id=result.id and user_id=p_user_id;
  insert into public.source_rule_sources(rule_id,user_id,source_id,role,ordinal)
    select result.id,p_user_id,id,'PRIMARY',n-1 from unnest(p_primary_ids) with ordinality u(id,n)
    union all select result.id,p_user_id,id,'FALLBACK',n-1 from unnest(p_fallback_ids) with ordinality u(id,n)
    union all select result.id,p_user_id,id,'EXCLUDED',n-1 from unnest(p_excluded_ids) with ordinality u(id,n);
  return result;
end;
$$;
create function public.assign_document_source(p_user_id uuid,p_document_id uuid,p_source_id uuid default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then return false; end if;
  if p_source_id is not null and not exists(select 1 from public.knowledge_sources where id=p_source_id and user_id=p_user_id) then raise exception 'SOURCE_NOT_FOUND'; end if;
  update public.source_documents set source_id=p_source_id where id=p_document_id and user_id=p_user_id and status<>'DELETING';
  return found;
end;
$$;

create function public.get_knowledge_source_configuration(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  with config as (
    select jsonb_build_object(
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
  ) select value || jsonb_build_object('revision',md5(value::text)) from config;
$$;
create function public.delete_knowledge_source_item(p_user_id uuid,p_kind text,p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then return false; end if;
  if p_kind='source' then delete from public.knowledge_sources where id=p_id and user_id=p_user_id;
  elsif p_kind='rule' then delete from public.source_rules where id=p_id and user_id=p_user_id;
  else raise exception 'INVALID_SOURCE_RULE'; end if;
  return found;
end;
$$;
create function public.search_knowledge_source_chunks(p_user_id uuid,p_query text,p_source_ids uuid[],p_revision text,p_limit integer default 10)
returns table(source_id uuid,source_title text,chunk_id uuid,document_id uuid,document_name text,version integer,"position" integer,
  section text,content text,start_offset integer,end_offset integer,page_start integer,page_end integer,rank real)
language plpgsql stable security invoker set search_path='' as $$
declare terms tsquery;
begin
  if p_query is null or char_length(btrim(p_query)) not between 1 and 300 or p_limit is null or p_limit not between 1 and 20
    or p_source_ids is null or cardinality(p_source_ids)>20 or array_position(p_source_ids,null) is not null then raise exception 'INVALID_KNOWLEDGE_QUERY'; end if;
  if p_revision is null or (public.get_knowledge_source_configuration(p_user_id)->>'revision') is distinct from p_revision then raise exception 'SOURCE_CONFIGURATION_CHANGED'; end if;
  if cardinality(p_source_ids)=0 then return; end if;
  terms := websearch_to_tsquery('spanish'::regconfig,p_query) || websearch_to_tsquery('simple'::regconfig,p_query);
  if numnode(terms)=0 or querytree(terms) in ('','T') then return; end if;
  return query select s.id,s.title,c.id,c.document_id,d.name,c.version,c.position,c.section,c.content,c.start_offset,c.end_offset,c.page_start,c.page_end,
    ts_rank_cd(c.search_vector,terms,32)
  from public.knowledge_chunks c
  join public.source_documents d on d.id=c.document_id and d.user_id=c.user_id and d.version=c.version
  join public.knowledge_sources s on s.id=d.source_id and s.user_id=d.user_id and s.enabled
  join public.users u on u.id=d.user_id and u.status='ACTIVE'
  where c.user_id=p_user_id and s.id=any(p_source_ids) and d.status='READY' and d.indexed_at is not null and c.search_vector @@ terms
  order by array_position(p_source_ids,s.id),ts_rank_cd(c.search_vector,terms,32) desc,c.document_id,c.position limit p_limit;
end;
$$;
revoke all on function public.save_knowledge_source(uuid,text,integer,boolean,uuid),
  public.save_source_rule(uuid,text,text,text[],integer,boolean,boolean,uuid[],uuid[],uuid[],uuid),
  public.assign_document_source(uuid,uuid,uuid),public.search_knowledge_source_chunks(uuid,text,uuid[],text,integer),
  public.get_knowledge_source_configuration(uuid),public.delete_knowledge_source_item(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.save_knowledge_source(uuid,text,integer,boolean,uuid),
  public.save_source_rule(uuid,text,text,text[],integer,boolean,boolean,uuid[],uuid[],uuid[],uuid),
  public.assign_document_source(uuid,uuid,uuid),public.search_knowledge_source_chunks(uuid,text,uuid[],text,integer),
  public.get_knowledge_source_configuration(uuid),public.delete_knowledge_source_item(uuid,text,uuid) to service_role;
