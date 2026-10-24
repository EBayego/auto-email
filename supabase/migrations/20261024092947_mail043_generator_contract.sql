create function public.valid_reply_sources(p_sources jsonb) returns boolean
language sql immutable strict security invoker set search_path = '' as $$
  select extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","maxItems":12,"type":"array","items":{"oneOf":[{"type":"object","properties":{"kind":{"type":"string","const":"THREAD_MESSAGE"},"messageIndex":{"type":"integer","minimum":0,"maximum":19}},"required":["kind","messageIndex"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"HISTORICAL_MESSAGE"},"referenceId":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,512}$"}},"required":["kind","referenceId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","const":"KNOWLEDGE_FRAGMENT"},"sourceId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"documentId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"},"version":{"type":"integer","minimum":1,"maximum":2147483647},"chunkId":{"type":"string","format":"uuid","pattern":"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"}},"required":["kind","sourceId","documentId","version","chunkId"],"additionalProperties":false}]},"uniqueItems":true}'::json, p_sources);
$$;
revoke all on function public.valid_reply_sources(jsonb) from public, anon, authenticated;
grant execute on function public.valid_reply_sources(jsonb) to service_role;

alter table public.draft_generations
  add column sources_used jsonb not null default '[]'::jsonb,
  add constraint draft_generations_sources_used_check check (public.valid_reply_sources(sources_used)),
  drop constraint draft_generations_prompt_version_check,
  add constraint draft_generations_prompt_version_check check (prompt_version in (
    'mail020-v1', 'mail020-v2', 'mail027-v1', 'mail028-v1', 'mail028-v2',
    'mail039-v1', 'mail040-v1', 'mail041-v1', 'epic06-v1', 'mail043-v1'
  ));

-- Keep a minimal provenance snapshot even if a document is later removed.
-- Validate ownership and the exact chunk/version when the snapshot is written.
create function public.check_draft_source_references() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare source jsonb;
begin
  if not public.valid_reply_sources(new.sources_used) then
    raise exception 'INVALID_REPLY_SOURCES' using errcode = '23514';
  end if;
  for source in select value from jsonb_array_elements(new.sources_used) loop
    if source->>'kind' = 'KNOWLEDGE_FRAGMENT' and not exists (
      select 1 from public.knowledge_chunks c
      join public.source_documents d on d.id=c.document_id and d.user_id=c.user_id and d.version=c.version
      join public.knowledge_sources s on s.id=d.source_id and s.user_id=d.user_id
      where c.id=(source->>'chunkId')::uuid
        and c.user_id=new.user_id and c.document_id=(source->>'documentId')::uuid
        and c.version=(source->>'version')::integer
        and d.source_id=(source->>'sourceId')::uuid and d.status='READY' and s.enabled
    ) then
      raise exception 'INVALID_REPLY_SOURCE_REFERENCE' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.check_draft_source_references() from public, anon, authenticated;
grant execute on function public.check_draft_source_references() to service_role;
create trigger draft_generations_source_references
  before insert or update of sources_used, user_id on public.draft_generations
  for each row execute function public.check_draft_source_references();
