create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180 and name !~ '[[:cntrl:]/\\]'),
  mime_type text not null check (mime_type in ('application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  version integer not null default 1 check (version > 0),
  status text not null default 'PROCESSING' check (status in ('PROCESSING','READY','FAILED','DELETING')),
  error_code text check (error_code in ('INVALID_FORMAT','UNSAFE_FILE','NO_TEXT','TEXT_LIMIT','PARSER_TIMEOUT','UPLOAD_FAILED','PROCESSING_FAILED')),
  has_file boolean not null default false,
  text_length integer not null default 0 check (text_length between 0 and 1000000),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check ((status = 'READY' and has_file and text_length > 0 and error_code is null) or status <> 'READY'),
  check ((status = 'FAILED' and error_code is not null) or status <> 'FAILED')
);
create index source_documents_owner_date_idx on public.source_documents(user_id, uploaded_at desc);
create trigger source_documents_updated_at before update on public.source_documents
  for each row execute function public.touch_updated_at();

create table public.source_document_texts (
  document_id uuid primary key,
  user_id uuid not null,
  text_content text not null check (char_length(text_content) between 1 and 1000000),
  foreign key (document_id, user_id) references public.source_documents(id, user_id) on delete cascade
);
create index source_document_texts_owner_idx on public.source_document_texts(user_id);
alter table public.source_documents enable row level security;
alter table public.source_document_texts enable row level security;
revoke all on public.source_documents, public.source_document_texts from anon, authenticated;
grant select on public.source_documents, public.source_document_texts to authenticated;
grant select, insert, update, delete on public.source_documents, public.source_document_texts to service_role;
create policy source_documents_select_own on public.source_documents for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.users where id = (select auth.uid()) and status = 'ACTIVE'
  )
);
create policy source_document_texts_select_own on public.source_document_texts for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.source_documents d where d.id = document_id and d.user_id = (select auth.uid()) and d.status = 'READY'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-documents', 'knowledge-documents', false, 10485760,
  array['application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create policy knowledge_documents_read_own on storage.objects for select to authenticated using (
  bucket_id = 'knowledge-documents' and exists (
    select 1 from public.source_documents d
    where d.user_id = (select auth.uid()) and d.status = 'READY' and d.has_file
      and storage.objects.name = d.user_id::text || '/' || d.id::text
  )
);

-- Backend-only, SECURITY INVOKER: the authenticated client cannot bypass quotas or validation.
create function public.reserve_source_document(p_user_id uuid, p_name text, p_mime_type text, p_byte_size integer, p_sha256 text)
returns public.source_documents language plpgsql security invoker set search_path = '' as $$
declare result public.source_documents;
begin
  perform 1 from public.users where id = p_user_id and status = 'ACTIVE' for update;
  if not found then raise exception 'DOCUMENT_OWNER_UNAVAILABLE'; end if;
  if (select count(*) from public.source_documents where user_id = p_user_id) >= 10 then
    raise exception 'DOCUMENT_LIMIT';
  end if;
  if exists (select 1 from public.source_documents where user_id = p_user_id and status = 'PROCESSING' and uploaded_at > now() - interval '5 minutes') then
    raise exception 'DOCUMENT_BUSY';
  end if;
  insert into public.source_documents(user_id,name,mime_type,byte_size,sha256)
    values(p_user_id,p_name,p_mime_type,p_byte_size,p_sha256) returning * into result;
  return result;
end;
$$;
create function public.complete_source_document(p_user_id uuid, p_document_id uuid, p_text text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.users where id = p_user_id and status = 'ACTIVE' for share;
  if not found then return false; end if;
  update public.source_documents set status = 'READY', has_file = true, text_length = char_length(p_text), error_code = null
    where id = p_document_id and user_id = p_user_id and status = 'PROCESSING';
  if not found then return false; end if;
  insert into public.source_document_texts(document_id,user_id,text_content) values(p_document_id,p_user_id,p_text);
  return true;
end;
$$;
create function public.begin_source_document_deletion(p_user_id uuid, p_document_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.source_documents set status = 'DELETING', text_length = 0
    where id = p_document_id and user_id = p_user_id
      and (status <> 'PROCESSING' or uploaded_at < now() - interval '5 minutes');
  if not found then return false; end if;
  delete from public.source_document_texts where document_id = p_document_id and user_id = p_user_id;
  return true;
end;
$$;
revoke all on function public.reserve_source_document(uuid,text,text,integer,text),
  public.complete_source_document(uuid,uuid,text), public.begin_source_document_deletion(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_source_document(uuid,text,text,integer,text),
  public.complete_source_document(uuid,uuid,text), public.begin_source_document_deletion(uuid,uuid) to service_role;
