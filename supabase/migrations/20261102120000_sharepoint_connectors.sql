-- Read-only SharePoint connectors. All mutations and secret access are backend-only.
create table public.microsoft_connections (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  tenant_id text not null, account_id text not null, username text not null,
  status text not null default 'CONNECTED' check(status in ('CONNECTED','REAUTH_REQUIRED')),
  cache text not null, version integer not null default 1, cache_version integer not null default 1,
  token_lease uuid, token_lease_until timestamptz,
  created_at timestamptz not null default now(), unique(id,user_id), unique(user_id,tenant_id,account_id)
);
create table public.microsoft_oauth_attempts (
  state_hash text primary key, user_id uuid not null references public.users(id) on delete cascade,
  secret text not null, expires_at timestamptz not null default now()+interval '10 minutes'
);
create table public.sharepoint_ocr_usage (
  user_id uuid not null references public.users(id) on delete cascade, day date not null default (now() at time zone 'UTC')::date,
  reserved_pages integer not null check(reserved_pages>=0),primary key(user_id,day)
);
create table public.knowledge_connectors (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null, source_id uuid not null, title text not null check(char_length(title) between 1 and 100),
  site_id text not null, drive_id text not null, root_item_id text not null, root_ancestors text[] not null default '{}', web_url text not null,
  recursive boolean not null default true, interval_minutes integer not null default 15 check(interval_minutes between 5 and 1440),
  audience_kind text not null default 'GENERAL' check(audience_kind in ('GENERAL','DOMAIN','RECIPIENT')), audience_key text not null default '',
  review_only boolean not null default true, status text not null default 'ACTIVE' check(status in ('ACTIVE','PAUSED')),
  phase text not null default 'DELTA' check(phase in ('DELTA','INDEX','IDLE')),
  delta_link text, next_link text, full_scan boolean not null default true, generation integer not null default 1,
  lease_id uuid, lease_until timestamptz, version integer not null default 1,
  next_sync_at timestamptz not null default now(), last_sync_at timestamptz, error_code text,
  unique(id,user_id), unique(source_id,user_id), unique(connection_id,drive_id,root_item_id),
  foreign key(connection_id,user_id) references public.microsoft_connections(id,user_id) on delete cascade,
  foreign key(source_id,user_id) references public.knowledge_sources(id,user_id) on delete cascade
);
create index knowledge_connectors_due on public.knowledge_connectors(next_sync_at) where status='ACTIVE';
alter table public.source_documents add column connector_id uuid,
  add column origin_url text,
  add constraint source_documents_connector_owner foreign key(connector_id,user_id) references public.knowledge_connectors(id,user_id) on delete cascade;
alter table public.source_documents drop constraint source_documents_check,
  add constraint source_documents_check check ((status='READY' and (has_file or connector_id is not null) and text_length>0 and error_code is null) or status<>'READY');
alter table public.source_documents drop constraint source_documents_mime_type_check,
  add constraint source_documents_mime_type_check check(connector_id is not null or mime_type in ('application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
alter table public.source_documents drop constraint source_documents_byte_size_check,
  add constraint source_documents_byte_size_check check(byte_size between 1 and 52428800 and (connector_id is not null or byte_size<=10485760));
create table public.sharepoint_items (
  connector_id uuid not null, user_id uuid not null, item_id text not null, parent_id text,
  name text not null default '', etag text not null default '', size bigint not null default 0,
  mime_type text not null default '', web_url text not null default '', modified_at timestamptz not null default now(),
  is_folder boolean not null default false, is_deleted boolean not null default false, remote_link boolean not null default false,
  generation integer not null, in_scope boolean not null default false,
  status text not null default 'DISCOVERED' check(status in ('DISCOVERED','PENDING','READY','OMITTED','FAILED','REMOVED')),
  error_code text, document_id uuid, audience_kind text check(audience_kind in ('GENERAL','DOMAIN','RECIPIENT')),audience_key text,primary key(connector_id,item_id),
  foreign key(connector_id,user_id) references public.knowledge_connectors(id,user_id) on delete cascade,
  foreign key(document_id,user_id) references public.source_documents(id,user_id) on delete set null (document_id)
);
create index sharepoint_items_work on public.sharepoint_items(connector_id,status);
create index sharepoint_items_parent on public.sharepoint_items(connector_id,parent_id);
create index sharepoint_items_document on public.sharepoint_items(document_id) where document_id is not null;
alter table public.microsoft_connections enable row level security;
alter table public.microsoft_oauth_attempts enable row level security;
alter table public.knowledge_connectors enable row level security;
alter table public.sharepoint_items enable row level security;
alter table public.sharepoint_ocr_usage enable row level security;
revoke all on public.sharepoint_ocr_usage from public,anon,authenticated;
grant all on public.sharepoint_ocr_usage to service_role;
revoke all on public.microsoft_connections,public.microsoft_oauth_attempts,public.knowledge_connectors,public.sharepoint_items from public,anon,authenticated;
grant all on public.microsoft_connections,public.microsoft_oauth_attempts,public.knowledge_connectors,public.sharepoint_items to service_role;

-- Authenticated SQL clients cannot read imported text behind the Graph revalidation boundary.
create policy sharepoint_document_boundary on public.source_documents as restrictive for select to authenticated using(connector_id is null);
create policy sharepoint_text_boundary on public.source_document_texts as restrictive for select to authenticated using(
  exists(select 1 from public.source_documents d where d.id=source_document_texts.document_id and d.user_id=source_document_texts.user_id and d.connector_id is null));
create policy sharepoint_chunk_boundary on public.knowledge_chunks as restrictive for select to authenticated using(
  exists(select 1 from public.source_documents d where d.id=knowledge_chunks.document_id and d.user_id=knowledge_chunks.user_id and d.connector_id is null));

create function public.sharepoint_command(p_user_id uuid,p_action text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.knowledge_connectors; m public.microsoft_connections; item jsonb; v_id uuid; v_source uuid; v_doc uuid;
  v_version integer; v_old text; v_count integer; v_scope text[]; v_audience text;v_key text;
begin
  if p_action='claim' then
    select k.* into c from public.knowledge_connectors k
      join public.microsoft_connections x on x.id=k.connection_id and x.user_id=k.user_id and x.status='CONNECTED'
      join public.users u on u.id=k.user_id and u.status='ACTIVE' and public.privacy_authorization_valid(u.id,p_input->>'noticeHash')
      where k.status='ACTIVE' and k.next_sync_at<=now() and (k.lease_until is null or k.lease_until<now())
      order by k.next_sync_at,k.id for update of k skip locked limit 1;
    if not found then return null; end if;
    update public.knowledge_connectors set lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',
      phase=case when phase='IDLE' then 'DELTA' else phase end where id=c.id returning * into c;
    return to_jsonb(c);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,102));
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then raise exception 'CONNECTOR_OWNER_UNAVAILABLE'; end if;
  if p_action in ('oauth_put','oauth_take','connection_save','token_acquire','token_save','assert_read','create','page','pending','cached_hash','document_unchanged','document_save','heartbeat','document_meta','ocr_reserve') and not public.privacy_authorization_valid(p_user_id) then raise exception 'PRIVACY_CONSENT_REQUIRED'; end if;
  if p_action='ocr_reserve' then
    if (p_input->>'pages')::integer not between 1 and 101 or (p_input->>'limit')::integer not between 1 and 100000 then raise exception 'CONNECTOR_LIMIT'; end if;
    delete from public.sharepoint_ocr_usage where user_id=p_user_id and day<(now() at time zone 'UTC')::date-30;
    insert into public.sharepoint_ocr_usage(user_id,reserved_pages) values(p_user_id,(p_input->>'pages')::integer)
      on conflict(user_id,day) do update set reserved_pages=sharepoint_ocr_usage.reserved_pages+excluded.reserved_pages
      where sharepoint_ocr_usage.reserved_pages+excluded.reserved_pages<=(p_input->>'limit')::integer returning reserved_pages into v_count;
    if not found or v_count>(p_input->>'limit')::integer then raise exception 'OCR_DAILY_BUDGET'; end if;return 'true';
  elsif p_action='export' then
    return jsonb_build_object('connections',coalesce((select jsonb_agg(to_jsonb(x)-'cache'-'cache_version'-'token_lease'-'token_lease_until') from public.microsoft_connections x where x.user_id=p_user_id),'[]'::jsonb),
      'connectors',coalesce((select jsonb_agg(to_jsonb(k)-'delta_link'-'next_link'-'lease_id'-'lease_until') from public.knowledge_connectors k where k.user_id=p_user_id),'[]'::jsonb),
      'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.sharepoint_items i where i.user_id=p_user_id and i.in_scope),'[]'::jsonb),
      'ocr_usage',coalesce((select jsonb_agg(to_jsonb(u)) from public.sharepoint_ocr_usage u where u.user_id=p_user_id),'[]'::jsonb));
  elsif p_action='list' then
    return jsonb_build_object('connections',coalesce((select jsonb_agg(to_jsonb(x)-'cache'-'cache_version'-'token_lease'-'token_lease_until'-'user_id') from public.microsoft_connections x where user_id=p_user_id),'[]'::jsonb),
      'connectors',coalesce((select jsonb_agg((to_jsonb(k)-'lease_id'-'lease_until'-'delta_link'-'next_link'-'user_id')||jsonb_build_object(
        'discovered',(select count(*) from public.sharepoint_items i where i.connector_id=k.id and i.in_scope and not i.is_folder),
        'ready',(select count(*) from public.sharepoint_items i where i.connector_id=k.id and i.in_scope and i.status='READY'),
        'pending',(select count(*) from public.sharepoint_items i where i.connector_id=k.id and i.in_scope and i.status='PENDING'),
        'omitted',(select count(*) from public.sharepoint_items i where i.connector_id=k.id and i.in_scope and i.status='OMITTED'),
        'failed',(select count(*) from public.sharepoint_items i where i.connector_id=k.id and i.in_scope and i.status='FAILED')) order by k.title) from public.knowledge_connectors k where user_id=p_user_id),'[]'::jsonb));
  elsif p_action='oauth_put' then
    delete from public.microsoft_oauth_attempts where expires_at<now() or user_id=p_user_id;
    insert into public.microsoft_oauth_attempts(state_hash,user_id,secret) values(p_input->>'hash',p_user_id,p_input->>'secret'); return 'true';
  elsif p_action='oauth_take' then
    delete from public.microsoft_oauth_attempts where state_hash=p_input->>'hash' and user_id=p_user_id and expires_at>now() returning secret into v_old;
    if not found then raise exception 'INVALID_OAUTH_STATE'; end if; return to_jsonb(v_old);
  elsif p_action='connection_save' then
    insert into public.microsoft_connections(user_id,tenant_id,account_id,username,cache)
      values(p_user_id,p_input->>'tenant',p_input->>'account',p_input->>'username',p_input->>'cache')
      on conflict(user_id,tenant_id,account_id) do update set cache=excluded.cache,status='CONNECTED',version=microsoft_connections.version+1,cache_version=microsoft_connections.cache_version+1
      returning * into m;
    return to_jsonb(m)-'cache';
  elsif p_action in ('connection','token_acquire','token_save','token_release','reauth','disconnect','assert_read') then
    select * into m from public.microsoft_connections where user_id=p_user_id and id=(p_input->>'id')::uuid for update;
    if not found then raise exception 'CONNECTOR_NOT_FOUND'; end if;
    if p_action='disconnect' then
      update public.knowledge_sources set enabled=false where user_id=p_user_id and id in(select source_id from public.knowledge_connectors where connection_id=m.id);
      delete from public.microsoft_connections where id=m.id; return 'true';
    elsif p_action='reauth' then
      update public.microsoft_connections set status='REAUTH_REQUIRED',version=version+1,cache='' where id=m.id; return 'true';
    elsif p_action='token_release' then
      update public.microsoft_connections set token_lease=null,token_lease_until=null where id=m.id and token_lease=(p_input->>'lease')::uuid; return 'true';
    end if;
    if m.status<>'CONNECTED' then raise exception 'REAUTH_REQUIRED'; end if;
    if p_action='assert_read' then return 'true'; end if;
    if p_action='token_acquire' then
      if m.token_lease_until>now() then raise exception 'TOKEN_BUSY'; end if;
      update public.microsoft_connections set token_lease=(p_input->>'lease')::uuid,token_lease_until=now()+interval '90 seconds' where id=m.id;
    elsif p_action='token_save' then
      update public.microsoft_connections set cache=p_input->>'cache',cache_version=cache_version+1 where id=m.id and token_lease=(p_input->>'lease')::uuid and token_lease_until>now();
      if not found then raise exception 'TOKEN_BUSY'; end if;
    end if;
    return to_jsonb(m);
  elsif p_action='create' then
    select * into m from public.microsoft_connections where id=(p_input->>'connectionId')::uuid and user_id=p_user_id and status='CONNECTED' for update;
    if not found then raise exception 'CONNECTOR_NOT_FOUND'; end if;
    if (select count(*) from public.knowledge_connectors where user_id=p_user_id)>=20 then raise exception 'CONNECTOR_LIMIT'; end if;
    -- The provider checks ancestor relationships; lock the connection so concurrent creates cannot overlap.
    if exists(select 1 from public.knowledge_connectors k where k.connection_id=m.id and k.drive_id=p_input->>'driveId' and
      (k.root_item_id=p_input->>'rootId' or k.root_item_id in(select jsonb_array_elements_text(p_input->'ancestors')) or p_input->>'rootId'=any(k.root_ancestors))) then raise exception 'OVERLAPPING_ROOTS'; end if;
    select id into v_source from public.save_knowledge_source(p_user_id,p_input->>'title',100,not (p_input->>'reviewOnly')::boolean,null);
    insert into public.knowledge_connectors(user_id,connection_id,source_id,title,site_id,drive_id,root_item_id,root_ancestors,web_url,recursive,interval_minutes,audience_kind,audience_key,review_only)
      values(p_user_id,m.id,v_source,p_input->>'title',p_input->>'siteId',p_input->>'driveId',p_input->>'rootId',array(select jsonb_array_elements_text(p_input->'ancestors')),p_input->>'webUrl',
        (p_input->>'recursive')::boolean,(p_input->>'intervalMinutes')::integer,p_input#>>'{audience,kind}',p_input#>>'{audience,key}',(p_input->>'reviewOnly')::boolean) returning id into v_id;
    return jsonb_build_object('id',v_id,'sourceId',v_source);
  elsif p_action='document_meta' then
    return coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('connector',to_jsonb(k),'connection_version',x.version,'connection_status',x.status,'document_version',d.version))
      from public.sharepoint_items i join public.knowledge_connectors k on k.id=i.connector_id and k.user_id=i.user_id
      join public.microsoft_connections x on x.id=k.connection_id and x.user_id=k.user_id
      join public.source_documents d on d.id=i.document_id and d.user_id=i.user_id
      where i.user_id=p_user_id and i.document_id in(select value::uuid from jsonb_array_elements_text(p_input->'ids'))),'[]'::jsonb);
  end if;
  select * into c from public.knowledge_connectors where user_id=p_user_id and id=(p_input->>'id')::uuid for update;
  if not found then raise exception 'CONNECTOR_NOT_FOUND'; end if;
  if p_action='items' then
    return coalesce((select jsonb_agg(to_jsonb(t)) from(select * from public.sharepoint_items where connector_id=c.id and in_scope and not is_folder order by item_id limit 100 offset least(5000,greatest(0,coalesce((p_input->>'offset')::integer,0)))) t),'[]'::jsonb);
  elsif p_action='remove' then
    update public.knowledge_sources set enabled=false where id=c.source_id and user_id=p_user_id;
    delete from public.knowledge_connectors where id=c.id; return 'true';
  elsif p_action='pause' then
    update public.knowledge_connectors set status='PAUSED',lease_id=null,lease_until=null,version=version+1 where id=c.id; return 'true';
  elsif p_action in ('sync','resume') then
    update public.knowledge_connectors set status='ACTIVE',next_sync_at=now(),error_code=null where id=c.id;
    update public.sharepoint_items set status='PENDING',error_code=null where connector_id=c.id and in_scope and status in ('FAILED','OMITTED') and not is_folder;
    -- Pending retries must be indexed even if the delta response is empty.
    return 'true';
  elsif p_action='configure' then
    if exists(select 1 from public.sharepoint_items i where i.connector_id=c.id and i.audience_kind is not null and not(
      p_input#>>'{audience,kind}'='GENERAL' or (i.audience_kind=p_input#>>'{audience,kind}' and i.audience_key=p_input#>>'{audience,key}') or
      (p_input#>>'{audience,kind}'='DOMAIN' and i.audience_kind='RECIPIENT' and split_part(i.audience_key,'@',2)=p_input#>>'{audience,key}'))) then raise exception 'AUDIENCE_CONFLICT'; end if;
    update public.knowledge_connectors set recursive=(p_input->>'recursive')::boolean,interval_minutes=(p_input->>'intervalMinutes')::integer,
      audience_kind=p_input#>>'{audience,kind}',audience_key=p_input#>>'{audience,key}',review_only=(p_input->>'reviewOnly')::boolean,
      version=version+1,phase='DELTA',full_scan=true,generation=generation+1,next_link=null,delta_link=null,lease_id=null,lease_until=null,next_sync_at=now() where id=c.id;
    update public.knowledge_sources set enabled=not (p_input->>'reviewOnly')::boolean where id=c.source_id and user_id=p_user_id;
    update public.source_documents d set status='PROCESSING',audience_kind=coalesce(i.audience_kind,p_input#>>'{audience,kind}'),audience_key=coalesce(i.audience_key,p_input#>>'{audience,key}') from public.sharepoint_items i where d.connector_id=c.id and i.document_id=d.id;
    update public.sharepoint_items set status='PENDING' where connector_id=c.id and in_scope and not is_folder; return 'true';
  elsif p_action='file_audience' then
    v_audience:=coalesce(p_input#>>'{audience,kind}',c.audience_kind);v_key:=coalesce(p_input#>>'{audience,key}',c.audience_key);
    if not(c.audience_kind='GENERAL' or (v_audience=c.audience_kind and v_key=c.audience_key) or (c.audience_kind='DOMAIN' and v_audience='RECIPIENT' and split_part(v_key,'@',2)=c.audience_key)) then raise exception 'AUDIENCE_CONFLICT'; end if;
    update public.sharepoint_items set audience_kind=p_input#>>'{audience,kind}',audience_key=p_input#>>'{audience,key}' where connector_id=c.id and item_id=p_input->>'itemId' and in_scope and not is_folder returning document_id into v_doc;
    if not found then raise exception 'CONNECTOR_NOT_FOUND'; end if;
    update public.source_documents set audience_kind=v_audience,audience_key=v_key where id=v_doc and user_id=p_user_id;
    update public.knowledge_connectors set version=version+1 where id=c.id;return 'true';
  end if;
  -- Every worker checkpoint is fenced by the same lease and connection state.
  if c.status<>'ACTIVE' or c.lease_id is distinct from (p_input->>'lease')::uuid or c.lease_until<=now() or not exists(select 1 from public.microsoft_connections where id=c.connection_id and status='CONNECTED') then raise exception 'CONNECTOR_LEASE_LOST'; end if;
  update public.knowledge_connectors set lease_until=now()+interval '5 minutes' where id=c.id;
  if p_action='page' then
    if jsonb_array_length(p_input->'items')>5000 then raise exception 'CONNECTOR_LIMIT'; end if;
    for item in select value from jsonb_array_elements(p_input->'items') loop
      insert into public.sharepoint_items(connector_id,user_id,item_id,parent_id,name,etag,size,mime_type,web_url,modified_at,is_folder,is_deleted,remote_link,generation)
        values(c.id,p_user_id,item->>'id',item#>>'{parentReference,id}',coalesce(item->>'name',''),coalesce(item->>'eTag',''),coalesce((item->>'size')::bigint,0),coalesce(item#>>'{file,mimeType}',''),coalesce(item->>'webUrl',''),coalesce((item->>'lastModifiedDateTime')::timestamptz,now()),item?'folder',item?'deleted',item?'remoteItem',c.generation)
        on conflict(connector_id,item_id) do update set parent_id=coalesce(excluded.parent_id,sharepoint_items.parent_id),name=case when item?'name' then excluded.name else sharepoint_items.name end,
          etag=case when item?'eTag' then excluded.etag else sharepoint_items.etag end,size=excluded.size,mime_type=case when item?'file' then excluded.mime_type else sharepoint_items.mime_type end,
          web_url=case when item?'webUrl' then excluded.web_url else sharepoint_items.web_url end,modified_at=excluded.modified_at,
          is_folder=case when item?'folder' then true else sharepoint_items.is_folder end,is_deleted=excluded.is_deleted,remote_link=excluded.remote_link,generation=excluded.generation,
          status=case when excluded.is_deleted then 'REMOVED' when excluded.etag<>sharepoint_items.etag or excluded.parent_id is distinct from sharepoint_items.parent_id then 'PENDING' else sharepoint_items.status end;
    end loop;
    if (select count(*) from public.sharepoint_items where connector_id=c.id)>50000 then raise exception 'CONNECTOR_LIMIT'; end if;
    -- Pending/removed remote items are rejected by the evidence guard. Keep the
    -- prior index private until a replacement is ready, so identical bytes need no OCR.
    update public.knowledge_connectors set next_link=p_input->>'next',delta_link=coalesce(p_input->>'delta',delta_link) where id=c.id;
    if p_input->>'next' is null then
      if p_input->>'delta' is null then raise exception 'INVALID_GRAPH_RESPONSE'; end if;
      if c.full_scan then update public.sharepoint_items set is_deleted=true,status='REMOVED' where connector_id=c.id and generation<>c.generation; end if;
      if not exists(select 1 from public.sharepoint_items where connector_id=c.id and item_id=c.root_item_id and not is_deleted and is_folder and not remote_link) then raise exception 'ROOT_UNAVAILABLE'; end if;
      with recursive scope as (
        select item_id from public.sharepoint_items where connector_id=c.id and item_id=c.root_item_id and not is_deleted and not remote_link
        union
        select i.item_id from public.sharepoint_items i join scope s on i.parent_id=s.item_id where i.connector_id=c.id and not i.is_deleted and not i.remote_link and (c.recursive or s.item_id=c.root_item_id)
      ) select array_agg(item_id) into v_scope from scope;
      update public.sharepoint_items set in_scope=item_id=any(v_scope) and item_id<>c.root_item_id,
        status=case when not(item_id=any(v_scope)) or is_deleted then 'REMOVED' when not is_folder and status in ('DISCOVERED','REMOVED') then 'PENDING' else status end where connector_id=c.id;
      delete from public.source_documents d using public.sharepoint_items i where i.connector_id=c.id and i.document_id=d.id and not i.in_scope;
      update public.sharepoint_items set name='',mime_type='',web_url='',size=0 where connector_id=c.id and not in_scope;
      update public.knowledge_connectors set phase='INDEX',full_scan=false where id=c.id;
    end if;
  elsif p_action='pending' then
    return coalesce((select jsonb_agg(to_jsonb(t)) from(select * from public.sharepoint_items where connector_id=c.id and in_scope and not is_folder and status='PENDING' order by item_id limit 5) t),'[]'::jsonb);
  elsif p_action='cached_hash' then
    return (select jsonb_build_object('hash',d.sha256,'ready',d.status='READY' and d.indexed_at is not null) from public.sharepoint_items i join public.source_documents d on d.id=i.document_id and d.user_id=i.user_id where i.connector_id=c.id and i.item_id=p_input->>'itemId' and i.in_scope and i.status='PENDING');
  elsif p_action='document_unchanged' then
    select d.id into v_doc from public.sharepoint_items i join public.source_documents d on d.id=i.document_id and d.user_id=i.user_id where i.connector_id=c.id and i.item_id=p_input->>'itemId' and i.in_scope and i.status='PENDING' and d.sha256=p_input->>'hash' and d.status='READY' and d.indexed_at is not null;
    if not found then raise exception 'CONNECTOR_LEASE_LOST'; end if;
    update public.source_documents set name=p_input->>'name',origin_url=p_input->>'url',content_updated_at=(p_input->>'modifiedAt')::timestamptz where id=v_doc;
    update public.sharepoint_items set status='READY',error_code=null,name=p_input->>'name',web_url=p_input->>'url' where connector_id=c.id and item_id=p_input->>'itemId';
  elsif p_action='document_save' then
    select document_id,coalesce(audience_kind,c.audience_kind),coalesce(audience_key,c.audience_key) into v_doc,v_audience,v_key from public.sharepoint_items where connector_id=c.id and item_id=p_input->>'itemId' and in_scope and status='PENDING' for update;
    if not found then raise exception 'CONNECTOR_LEASE_LOST'; end if;
    if (select coalesce(sum(byte_size),0) from public.source_documents where user_id=p_user_id and connector_id is not null and id is distinct from v_doc)+(p_input->>'size')::bigint>2147483648 then raise exception 'CONNECTOR_LIMIT'; end if;
    if v_doc is null then
      if (select count(*) from public.source_documents where user_id=p_user_id and connector_id is not null)>=5000 or
        (select coalesce(sum(byte_size),0) from public.source_documents where user_id=p_user_id and connector_id is not null)+(p_input->>'size')::bigint>2147483648 then raise exception 'CONNECTOR_LIMIT'; end if;
      insert into public.source_documents(user_id,name,mime_type,byte_size,sha256,connector_id,source_id,origin_url,status,has_file,text_length,audience_kind,audience_key)
        values(p_user_id,p_input->>'name',p_input->>'mime',(p_input->>'size')::integer,p_input->>'hash',c.id,c.source_id,p_input->>'url','PROCESSING',false,0,v_audience,v_key) returning id into v_doc;
    else
      update public.source_documents set status='PROCESSING',name=p_input->>'name',mime_type=p_input->>'mime',byte_size=(p_input->>'size')::integer,
        version=version+1,sha256=p_input->>'hash',origin_url=p_input->>'url',error_code=null where id=v_doc and user_id=p_user_id;
    end if;
    insert into public.source_document_texts(document_id,user_id,text_content) values(v_doc,p_user_id,p_input->>'text')
      on conflict(document_id) do update set text_content=excluded.text_content;
    update public.source_documents set status='READY',text_length=char_length(p_input->>'text'),error_code=null where id=v_doc returning version into v_version;
    if not public.replace_knowledge_index(p_user_id,v_doc,v_version,p_input->>'hash',md5(p_input->>'text'),p_input->'index') then raise exception 'INVALID_DOCUMENT_INDEX'; end if;
    update public.source_documents set content_updated_at=(p_input->>'modifiedAt')::timestamptz where id=v_doc;
    update public.sharepoint_items set document_id=v_doc,status='READY',error_code=null,name=p_input->>'name',mime_type=p_input->>'mime',web_url=p_input->>'url',size=(p_input->>'size')::bigint where connector_id=c.id and item_id=p_input->>'itemId';
  elsif p_action='item_error' then
    update public.sharepoint_items set status=case when coalesce((p_input->>'omitted')::boolean,false) then 'OMITTED' else 'FAILED' end,error_code=p_input->>'error' where connector_id=c.id and item_id=p_input->>'itemId';
    update public.source_documents d set status='PROCESSING' from public.sharepoint_items i where i.connector_id=c.id and i.item_id=p_input->>'itemId' and i.document_id=d.id;
  elsif p_action='reset' then
    update public.knowledge_connectors set phase='DELTA',full_scan=true,generation=generation+1,delta_link=null,next_link=null where id=c.id;
  elsif p_action='heartbeat' then
    null;
  elsif p_action='release' then
    update public.knowledge_connectors set lease_id=null,lease_until=null,error_code=p_input->>'error',
      phase=case when phase='INDEX' and not exists(select 1 from public.sharepoint_items where connector_id=c.id and in_scope and status='PENDING' and not is_folder) then 'IDLE' else phase end,
      last_sync_at=case when phase='INDEX' and not exists(select 1 from public.sharepoint_items where connector_id=c.id and in_scope and status='PENDING' and not is_folder) then now() else last_sync_at end,
      next_sync_at=now()+case when p_input->>'error' is not null then make_interval(secs=>least(3600,greatest(30,coalesce((p_input->>'retryAfter')::integer,60))))
        when phase='INDEX' and not exists(select 1 from public.sharepoint_items where connector_id=c.id and in_scope and status='PENDING' and not is_folder) then make_interval(mins=>interval_minutes) else interval '0 seconds' end where id=c.id;
  else raise exception 'INVALID_CONNECTOR_ACTION';
  end if;
  return 'true';
end;
$$;
revoke all on function public.sharepoint_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sharepoint_command(uuid,text,jsonb) to service_role;

-- Preserve manual upload quotas independently of the imported corpus.
create or replace function public.reserve_source_document(p_user_id uuid,p_name text,p_mime_type text,p_byte_size integer,p_sha256 text)
returns public.source_documents language plpgsql security invoker set search_path='' as $$
declare result public.source_documents;
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'DOCUMENT_OWNER_UNAVAILABLE'; end if;
  if (select count(*) from public.source_documents where user_id=p_user_id and connector_id is null)>=10 then raise exception 'DOCUMENT_LIMIT'; end if;
  if exists(select 1 from public.source_documents where user_id=p_user_id and connector_id is null and status='PROCESSING' and uploaded_at>now()-interval '5 minutes') then raise exception 'DOCUMENT_BUSY'; end if;
  insert into public.source_documents(user_id,name,mime_type,byte_size,sha256) values(p_user_id,p_name,p_mime_type,p_byte_size,p_sha256) returning * into result;
  return result;
end;
$$;

alter function public.get_knowledge_source_configuration(uuid) rename to get_manual_knowledge_source_configuration;
create function public.get_knowledge_source_configuration(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  with base as(select public.get_manual_knowledge_source_configuration(p_user_id) as value),
  connectors as(select coalesce(jsonb_agg(jsonb_build_array(k.id,k.version,k.review_only,k.status,x.status,x.version) order by k.id),'[]'::jsonb) as value
    from public.knowledge_connectors k join public.microsoft_connections x on x.id=k.connection_id and x.user_id=k.user_id where k.user_id=p_user_id)
  select case when connectors.value='[]'::jsonb then base.value else base.value||jsonb_build_object(
    'revision',md5((base.value->>'revision')||connectors.value::text),
    'sources',(select jsonb_agg(s.value||coalesce((select jsonb_build_object('connectorId',k.id) from public.knowledge_connectors k where k.source_id=(s.value->>'id')::uuid and k.user_id=p_user_id),'{}'::jsonb)||jsonb_build_object('enabled',(s.value->>'enabled')::boolean and not exists(
      select 1 from public.knowledge_connectors k join public.microsoft_connections x on x.id=k.connection_id
      where k.source_id=(s.value->>'id')::uuid and k.user_id=p_user_id and (k.review_only or x.status<>'CONNECTED')))) from jsonb_array_elements(base.value->'sources') s(value))) end from base,connectors;
$$;
revoke all on function public.get_knowledge_source_configuration(uuid) from public,anon,authenticated;
grant execute on function public.get_knowledge_source_configuration(uuid) to service_role;

-- Account erasure invalidates credentials as soon as the owner leaves ACTIVE.
create function public.stop_sharepoint_account_work() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'ACTIVE' then
    delete from public.microsoft_connections where user_id=new.id;
    delete from public.microsoft_oauth_attempts where user_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.stop_sharepoint_account_work() from public,anon,authenticated;
create trigger users_stop_sharepoint after update of status on public.users for each row execute function public.stop_sharepoint_account_work();

create function public.stop_sharepoint_privacy_work() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  target:=old.user_id;
  if tg_op='DELETE' or new.withdrawn_at is not null or new.notice_hash is distinct from old.notice_hash then
    update public.microsoft_connections set status='REAUTH_REQUIRED',cache='',version=version+1,token_lease=null,token_lease_until=null where user_id=target;
    update public.knowledge_connectors set status='PAUSED',version=version+1,lease_id=null,lease_until=null where user_id=target;
    delete from public.microsoft_oauth_attempts where user_id=target;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.stop_sharepoint_privacy_work() from public,anon,authenticated;
create trigger privacy_stop_sharepoint after update or delete on public.privacy_authorizations for each row execute function public.stop_sharepoint_privacy_work();

create function public.guard_sharepoint_document() returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.knowledge_connectors;
begin
  if tg_op='UPDATE' and old.connector_id is not null and new.connector_id is distinct from old.connector_id then raise exception 'INVALID_CONNECTOR_DOCUMENT'; end if;
  if new.connector_id is null then
    if exists(select 1 from public.knowledge_connectors where source_id=new.source_id and user_id=new.user_id) then raise exception 'INVALID_CONNECTOR_DOCUMENT'; end if;
    return new;
  end if;
  select * into c from public.knowledge_connectors where id=new.connector_id and user_id=new.user_id;
  if not found or new.source_id is distinct from c.source_id or new.has_file or not(c.audience_kind='GENERAL' or (new.audience_kind=c.audience_kind and new.audience_key=c.audience_key) or (c.audience_kind='DOMAIN' and new.audience_kind='RECIPIENT' and split_part(new.audience_key,'@',2)=c.audience_key)) then raise exception 'INVALID_CONNECTOR_DOCUMENT'; end if;
  return new;
end;
$$;
revoke all on function public.guard_sharepoint_document() from public,anon,authenticated;
grant execute on function public.guard_sharepoint_document() to service_role;
create trigger source_documents_sharepoint_guard before insert or update on public.source_documents for each row execute function public.guard_sharepoint_document();

-- The manual-document search endpoint never exposes imported text without Graph checks.
create or replace function public.search_knowledge_chunks(p_user_id uuid,p_query text,p_limit integer default 10,p_document_id uuid default null)
returns table(chunk_id uuid,document_id uuid,document_name text,version integer,"position" integer,section text,content text,start_offset integer,end_offset integer,page_start integer,page_end integer,rank real)
language plpgsql stable security invoker set search_path='' as $$
declare terms tsquery;
begin
  if p_query is null or char_length(btrim(p_query)) not between 1 and 300 or p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_KNOWLEDGE_QUERY'; end if;
  terms:=websearch_to_tsquery('spanish'::regconfig,p_query)||websearch_to_tsquery('simple'::regconfig,p_query);
  if numnode(terms)=0 or querytree(terms) in ('','T') then return; end if;
  return query select c.id,c.document_id,d.name,c.version,c.position,c.section,c.content,c.start_offset,c.end_offset,c.page_start,c.page_end,ts_rank_cd(c.search_vector,terms,32)
    from public.knowledge_chunks c join public.source_documents d on d.id=c.document_id and d.user_id=c.user_id and d.version=c.version
    join public.users u on u.id=d.user_id and u.status='ACTIVE'
    where c.user_id=p_user_id and d.connector_id is null and d.status='READY' and d.indexed_at is not null and (p_document_id is null or c.document_id=p_document_id) and c.search_vector@@terms
    order by ts_rank_cd(c.search_vector,terms,32) desc,c.document_id,c.position limit p_limit;
end;
$$;
