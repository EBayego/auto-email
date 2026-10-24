alter table public.source_documents
  add column content_updated_at timestamptz not null default now(),
  add column valid_from date,
  add column valid_until date,
  add constraint source_documents_validity_check check (
    (valid_from is null or valid_from between date '0001-01-01' and date '9999-12-31')
    and (valid_until is null or valid_until between date '0001-01-01' and date '9999-12-31')
    and (valid_from is null or valid_until is null or valid_from <= valid_until)
  );
-- Existing uploads have no declared factual validity. Reindexing and source
-- reassignment must never make their content appear newly authored.
update public.source_documents set content_updated_at=uploaded_at;

create function public.touch_document_content_date() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='source_documents' then
    if new.version is distinct from old.version or new.sha256 is distinct from old.sha256 then
      new.content_updated_at := clock_timestamp();
    end if;
    return new;
  end if;
  if new.text_content is distinct from old.text_content then
    update public.source_documents set content_updated_at=clock_timestamp()
      where id=new.document_id and user_id=new.user_id;
  end if;
  return new;
end;
$$;
create trigger source_documents_content_date before update of version,sha256 on public.source_documents
  for each row execute function public.touch_document_content_date();
create trigger source_document_texts_content_date after update of text_content on public.source_document_texts
  for each row execute function public.touch_document_content_date();

create function public.set_document_validity(p_user_id uuid,p_document_id uuid,p_valid_from date default null,p_valid_until date default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  update public.source_documents set valid_from=p_valid_from,valid_until=p_valid_until
    where id=p_document_id and user_id=p_user_id and status='READY';
  return found;
end;
$$;

create or replace function public.get_knowledge_source_configuration(p_user_id uuid) returns jsonb
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
  ) select value || jsonb_build_object('revision',md5(value::text || coalesce((
    select jsonb_agg(jsonb_build_array(d.id,d.source_id,d.version,d.status,d.content_updated_at,d.valid_from,d.valid_until,d.index_hash,d.indexed_at) order by d.id)::text
    from public.source_documents d where d.user_id=p_user_id),'[]'))) from config;
$$;

create function public.search_knowledge_context_chunks(p_user_id uuid,p_query text,p_source_ids uuid[],p_revision text,p_limit integer default 20)
returns table(source_id uuid,source_title text,chunk_id uuid,document_id uuid,document_name text,version integer,"position" integer,
  section text,content text,start_offset integer,end_offset integer,page_start integer,page_end integer,rank real,
  document_updated_at timestamptz,valid_from date,valid_until date)
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
      d.content_updated_at,d.valid_from,d.valid_until,
      row_number() over(partition by c.document_id order by ts_rank_cd(c.search_vector,terms,32) desc,c.position) as doc_rank
    from public.knowledge_chunks c
    join public.source_documents d on d.id=c.document_id and d.user_id=c.user_id and d.version=c.version
    join public.knowledge_sources s on s.id=d.source_id and s.user_id=d.user_id and s.enabled
    join public.users u on u.id=d.user_id and u.status='ACTIVE'
    where c.user_id=p_user_id and s.id=any(p_source_ids) and d.status='READY' and d.indexed_at is not null and c.search_vector @@ terms
  ) select t.sid,t.title,t.cid,t.document_id,t.name,t.version,t.position,t.section,t.content,t.start_offset,t.end_offset,
      t.page_start,t.page_end,t.relevance,t.content_updated_at,t.valid_from,t.valid_until
    from candidates t where t.doc_rank<=2
    order by t.relevance desc,t.content_updated_at desc,t.document_id,t.position limit p_limit;
end;
$$;
revoke all on function public.touch_document_content_date(),public.set_document_validity(uuid,uuid,date,date),
  public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer) from public,anon,authenticated;
grant execute on function public.touch_document_content_date(),public.set_document_validity(uuid,uuid,date,date),
  public.search_knowledge_context_chunks(uuid,text,uuid[],text,integer) to service_role;

alter table public.draft_generations
  drop constraint draft_generations_prompt_version_check,
  add constraint draft_generations_prompt_version_check
  check (prompt_version in ('mail020-v1', 'mail020-v2', 'mail027-v1', 'mail028-v1', 'mail028-v2', 'mail039-v1', 'mail040-v1'));
