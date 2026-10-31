create or replace function public.edit_writing_style(
  p_user_id uuid,p_account_id uuid,p_general_revision uuid,p_scope_kind text,p_scope_key text,
  p_profile_revision uuid default null,p_expected_revisions uuid[] default null,p_action text default null,p_preferences jsonb default null,p_reviewed boolean default false
) returns boolean language plpgsql security invoker set search_path='' as $$
declare general public.style_profiles%rowtype; target public.style_profiles%rowtype;
  actual uuid[]; expected uuid[]; rule_revisions uuid[];
begin
  if p_action is null or p_action not in ('SAVE','RESTORE','CONFIRM')
    or public.valid_style_scope(p_scope_kind,p_scope_key) is distinct from true
    or p_expected_revisions is null or coalesce(array_ndims(p_expected_revisions),1)<>1
    or cardinality(p_expected_revisions)>8 or array_position(p_expected_revisions,null) is not null
    or p_preferences is null or not extensions.jsonb_matches_schema(
      '{"type":"array","maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["key","value"],"properties":{"key":{"type":"string","enum":["greeting","language","length","formality","closing","emojis","warmth","help_offer"]},"value":{"type":"string","maxLength":32}}}}',p_preferences)
    or (p_action<>'SAVE' and p_preferences<>'[]'::jsonb)
    or (p_action='CONFIRM' and p_reviewed is distinct from true) then raise exception 'INVALID_INPUT'; end if;
  if (select count(distinct item->>'key') from jsonb_array_elements(p_preferences) item)<>jsonb_array_length(p_preferences)
    or (select count(distinct value) from unnest(p_expected_revisions) value)<>cardinality(p_expected_revisions) then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED' for update;
  if not found then raise exception 'NOT_CONNECTED'; end if;
  select * into general from public.style_profiles where user_id=p_user_id and gmail_account_id=p_account_id and scope_kind='GENERAL' and scope_key='' for update;
  if not found then raise exception 'STYLE_PROFILE_REQUIRED'; end if;
  if general.revision is distinct from p_general_revision then raise exception 'STALE_STYLE'; end if;
  select * into target from public.style_profiles where user_id=p_user_id and gmail_account_id=p_account_id and scope_kind=p_scope_kind and scope_key=p_scope_key for update;
  if target.revision is distinct from p_profile_revision then raise exception 'STALE_STYLE'; end if;
  perform 1 from public.style_preferences where user_id=p_user_id and gmail_account_id=p_account_id and scope_kind=p_scope_kind and scope_key=p_scope_key for update;
  select coalesce(array_agg(revision order by revision),'{}'::uuid[]) into actual from public.style_preferences
    where user_id=p_user_id and gmail_account_id=p_account_id and scope_kind=p_scope_kind and scope_key=p_scope_key;
  select coalesce(array_agg(value order by value),'{}'::uuid[]) into expected from unnest(p_expected_revisions) value;
  if actual is distinct from expected then raise exception 'STALE_PREFERENCE'; end if;
  if p_action='CONFIRM' then
    if target.id is null then raise exception 'STYLE_PROFILE_REQUIRED'; end if;
    if p_scope_kind<>'GENERAL' then
      if general.review_status<>'CONFIRMED' then raise exception 'GENERAL_PROFILE_REQUIRED'; end if;
      if target.parent_revision is distinct from general.revision or target.generated_at<clock_timestamp()-interval '90 days' or target.generated_at>clock_timestamp()+interval '5 seconds' then raise exception 'CONTEXT_NOT_CURRENT'; end if;
      if p_scope_kind='RELATIONSHIP' then
        select coalesce(array_agg(revision order by revision),'{}'::uuid[]) into rule_revisions from public.style_relationships where user_id=p_user_id and gmail_account_id=p_account_id;
        if (select coalesce(array_agg(value order by value),'{}'::uuid[]) from unnest(target.relationship_rule_revisions) value) is distinct from rule_revisions then raise exception 'CONTEXT_NOT_CURRENT'; end if;
      end if;
    end if;
    update public.style_profiles set review_status='CONFIRMED',reviewed_at=clock_timestamp() where id=target.id and user_id=p_user_id and review_status='UNREVIEWED';
    return true;
  end if;
  if (select count(*) from public.style_preferences where user_id=p_user_id and gmail_account_id=p_account_id)
    - cardinality(actual) + jsonb_array_length(p_preferences)>200 then raise exception 'INVALID_INPUT'; end if;
  delete from public.style_preferences p where p.user_id=p_user_id and p.gmail_account_id=p_account_id and p.scope_kind=p_scope_kind and p.scope_key=p_scope_key
    and not exists(select 1 from jsonb_array_elements(p_preferences) item where item->>'key'=p.preference_key);
  insert into public.style_preferences(user_id,gmail_account_id,scope_kind,scope_key,preference_key,preference_value)
    select p_user_id,p_account_id,p_scope_kind,p_scope_key,item->>'key',item->>'value' from jsonb_array_elements(p_preferences) item
    on conflict(gmail_account_id,scope_kind,scope_key,preference_key) do update set preference_value=excluded.preference_value;
  return true;
end;
$$;
revoke all on function public.edit_writing_style(uuid,uuid,uuid,text,text,uuid,uuid[],text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.edit_writing_style(uuid,uuid,uuid,text,text,uuid,uuid[],text,jsonb,boolean) to service_role;
