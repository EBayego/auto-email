alter table public.user_settings add column allow_partial_knowledge_drafts boolean not null default false;

create function public.set_knowledge_sufficiency_preferences(p_user_id uuid,p_allow_partial_drafts boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  if p_allow_partial_drafts is null then raise exception 'INVALID_SOURCE_RULE'; end if;
  update public.user_settings set allow_partial_knowledge_drafts=p_allow_partial_drafts where user_id=p_user_id;
  return found;
end;
$$;
revoke all on function public.set_knowledge_sufficiency_preferences(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_knowledge_sufficiency_preferences(uuid,boolean) to service_role;

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
    select jsonb_agg(jsonb_build_array(d.id,d.source_id,d.version,d.status,d.content_updated_at,d.valid_from,d.valid_until,d.index_hash,d.indexed_at) order by d.id)::text
    from public.source_documents d where d.user_id=p_user_id),'[]'))) from config;
$$;

alter table public.draft_generations
  drop constraint draft_generations_prompt_version_check,
  add constraint draft_generations_prompt_version_check
  check (prompt_version in ('mail020-v1', 'mail020-v2', 'mail027-v1', 'mail028-v1', 'mail028-v2', 'mail039-v1', 'mail040-v1', 'mail041-v1'));
