alter table public.source_documents
  add column indexed_at timestamptz,
  add column chunk_count integer not null default 0 check (chunk_count between 0 and 2000),
  add column indexer_version text check (indexer_version = 'mail037-v1'),
  add column index_hash text,
  add constraint source_documents_version_owner_unique unique (id, user_id, version);
alter table public.source_document_texts add column normalized_text text
  check (char_length(normalized_text) between 1 and 1000000);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null,
  version integer not null check (version > 0),
  position integer not null check (position between 0 and 1999),
  section text not null check (char_length(section) <= 500),
  content text not null check (char_length(content) between 1 and 2000),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset and end_offset <= 1000000),
  page_start integer check (page_start between 1 and 300),
  page_end integer check (page_end between page_start and 300),
  search_vector tsvector generated always as (
    setweight(to_tsvector('spanish'::regconfig, section), 'A') ||
    setweight(to_tsvector('spanish'::regconfig, content), 'B') ||
    setweight(to_tsvector('simple'::regconfig, section), 'A') ||
    setweight(to_tsvector('simple'::regconfig, content), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  foreign key (document_id, user_id, version) references public.source_documents(id, user_id, version) on delete cascade,
  unique (document_id, position),
  check ((page_start is null) = (page_end is null)),
  check (end_offset - start_offset = char_length(content))
);
create index knowledge_chunks_search_idx on public.knowledge_chunks using gin(search_vector);
create index knowledge_chunks_owner_document_idx on public.knowledge_chunks(user_id, document_id, version);
alter table public.knowledge_chunks enable row level security;
revoke all on public.knowledge_chunks from anon, authenticated;
grant select on public.knowledge_chunks to authenticated;
grant select, insert, update, delete on public.knowledge_chunks to service_role;
create policy knowledge_chunks_select_own on public.knowledge_chunks for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.source_documents d where d.id = document_id and d.user_id = (select auth.uid())
      and d.version = knowledge_chunks.version and d.status = 'READY' and d.indexed_at is not null
  )
);

create function public.invalidate_source_document_index() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.version <> old.version or new.sha256 <> old.sha256 or new.status <> 'READY' then
    delete from public.knowledge_chunks where document_id = old.id and user_id = old.user_id;
    update public.source_document_texts set normalized_text = null where document_id = old.id and user_id = old.user_id;
    new.indexed_at := null; new.chunk_count := 0; new.indexer_version := null; new.index_hash := null;
  end if;
  return new;
end;
$$;
create trigger source_documents_invalidate_index before update of version, sha256, status on public.source_documents
  for each row execute function public.invalidate_source_document_index();

create function public.invalidate_source_document_text_index() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' or new.text_content is distinct from old.text_content then
    delete from public.knowledge_chunks where document_id = old.document_id and user_id = old.user_id;
    update public.source_documents set indexed_at = null, chunk_count = 0, indexer_version = null, index_hash = null
      where id = old.document_id and user_id = old.user_id;
    if tg_op <> 'DELETE' then new.normalized_text := null; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger source_document_texts_invalidate_index before update of text_content or delete on public.source_document_texts
  for each row execute function public.invalidate_source_document_text_index();

create function public.replace_knowledge_index(p_user_id uuid, p_document_id uuid, p_version integer,
  p_sha256 text, p_text_hash text, p_index jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare doc public.source_documents; raw_text text; normalized text; size integer; fingerprint text;
begin
  if p_version is null or p_sha256 is null or p_text_hash is null then return false; end if;
  perform 1 from public.users where id = p_user_id and status = 'ACTIVE' for share;
  if not found then return false; end if;
  select * into doc from public.source_documents where id = p_document_id and user_id = p_user_id for update;
  if not found or doc.status <> 'READY' or doc.version <> p_version or doc.sha256 <> p_sha256 then return false; end if;
  select text_content into raw_text from public.source_document_texts where document_id = p_document_id and user_id = p_user_id for update;
  if not found or md5(raw_text) <> p_text_hash then return false; end if;
  if p_index is null or octet_length(p_index::text) > 10000000 or p_index->>'indexer_version' is distinct from 'mail037-v1'
    or jsonb_typeof(p_index->'normalized_text') is distinct from 'string' or jsonb_typeof(p_index->'chunks') is distinct from 'array' then
    raise exception 'INVALID_DOCUMENT_INDEX';
  end if;
  normalized := p_index->>'normalized_text'; size := jsonb_array_length(p_index->'chunks');
  if char_length(normalized) not between 1 and 1000000 or size not between 1 and 2000 then raise exception 'INVALID_DOCUMENT_INDEX'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_index->'chunks') with ordinality e(value, n)
    where jsonb_typeof(value) is distinct from 'object'
      or jsonb_typeof(value->'position') is distinct from 'number' or (value->>'position')::integer <> n - 1
      or jsonb_typeof(value->'section') is distinct from 'string' or jsonb_typeof(value->'content') is distinct from 'string'
      or jsonb_typeof(value->'start_offset') is distinct from 'number' or jsonb_typeof(value->'end_offset') is distinct from 'number'
      or substring(normalized from (value->>'start_offset')::integer + 1 for (value->>'end_offset')::integer - (value->>'start_offset')::integer) is distinct from value->>'content'
  ) then raise exception 'INVALID_DOCUMENT_INDEX'; end if;
  fingerprint := md5(p_index::text);
  if doc.indexed_at is not null and doc.index_hash = fingerprint then return true; end if;
  delete from public.knowledge_chunks where document_id = p_document_id and user_id = p_user_id;
  insert into public.knowledge_chunks(document_id,user_id,version,position,section,content,start_offset,end_offset,page_start,page_end)
    select p_document_id,p_user_id,p_version,c.position,c.section,c.content,c.start_offset,c.end_offset,c.page_start,c.page_end
    from jsonb_to_recordset(p_index->'chunks') c("position" integer,section text,content text,start_offset integer,end_offset integer,page_start integer,page_end integer);
  update public.source_document_texts set normalized_text = normalized where document_id = p_document_id and user_id = p_user_id;
  update public.source_documents set indexed_at = now(), chunk_count = size, indexer_version = 'mail037-v1', index_hash = fingerprint
    where id = p_document_id and user_id = p_user_id;
  return true;
end;
$$;

create function public.complete_indexed_source_document(p_user_id uuid, p_document_id uuid, p_text text, p_index jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare doc public.source_documents;
begin
  if not public.complete_source_document(p_user_id,p_document_id,p_text) then return false; end if;
  select * into doc from public.source_documents where id = p_document_id and user_id = p_user_id;
  if not public.replace_knowledge_index(p_user_id,p_document_id,doc.version,doc.sha256,md5(p_text),p_index) then
    raise exception 'DOCUMENT_INDEX_CONFLICT';
  end if;
  return true;
end;
$$;

create function public.search_knowledge_chunks(p_user_id uuid, p_query text, p_limit integer default 10, p_document_id uuid default null)
returns table(chunk_id uuid, document_id uuid, document_name text, version integer, "position" integer, section text,
  content text, start_offset integer, end_offset integer, page_start integer, page_end integer, rank real)
language plpgsql stable security invoker set search_path = '' as $$
declare terms tsquery;
begin
  if p_query is null or char_length(btrim(p_query)) not between 1 and 300 or p_limit is null or p_limit not between 1 and 20 then
    raise exception 'INVALID_KNOWLEDGE_QUERY';
  end if;
  terms := websearch_to_tsquery('spanish'::regconfig,p_query) || websearch_to_tsquery('simple'::regconfig,p_query);
  if numnode(terms) = 0 or querytree(terms) in ('','T') then return; end if;
  return query select c.id,c.document_id,d.name,c.version,c.position,c.section,c.content,c.start_offset,c.end_offset,c.page_start,c.page_end,
    ts_rank_cd(c.search_vector,terms,32) as rank
  from public.knowledge_chunks c
  join public.source_documents d on d.id = c.document_id and d.user_id = c.user_id and d.version = c.version
  join public.users u on u.id = d.user_id and u.status = 'ACTIVE'
  where c.user_id = p_user_id and d.status = 'READY' and d.indexed_at is not null
    and (p_document_id is null or c.document_id = p_document_id) and c.search_vector @@ terms
  order by ts_rank_cd(c.search_vector,terms,32) desc,c.document_id,c.position limit p_limit;
end;
$$;
revoke all on function public.invalidate_source_document_index(),public.invalidate_source_document_text_index(),
  public.replace_knowledge_index(uuid,uuid,integer,text,text,jsonb),public.complete_indexed_source_document(uuid,uuid,text,jsonb),
  public.search_knowledge_chunks(uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.invalidate_source_document_index(),public.invalidate_source_document_text_index(),
  public.replace_knowledge_index(uuid,uuid,integer,text,text,jsonb),public.complete_indexed_source_document(uuid,uuid,text,jsonb),
  public.search_knowledge_chunks(uuid,text,integer,uuid) to service_role;
