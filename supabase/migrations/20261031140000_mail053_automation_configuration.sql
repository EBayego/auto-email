alter table public.user_settings add column processing_scope text not null default 'ALL_INCOMING'
  check(processing_scope in ('ALL_INCOMING','INBOX','UNREAD_INBOX'));

create function public.get_automation_configuration(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',md5(value::text),'settings',value) from (
    select jsonb_build_object(
      'execution',jsonb_build_object('automationEnabled',s.automation_enabled,'pollIntervalSeconds',s.poll_interval_seconds,'maxDailyDrafts',s.max_daily_drafts),
      'processingScope',s.processing_scope,'excludedAddresses',s.classifier_excluded_addresses,
      'excludedDomains',s.classifier_excluded_domains,'policy',s.response_policy) value
    from public.user_settings s join public.users u on u.id=s.user_id where s.user_id=p_user_id and u.status='ACTIVE'
  ) config;
$$;
create function public.set_automation_configuration(p_user_id uuid,p_revision text,p_settings jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_value jsonb;
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.user_settings where user_id=p_user_id for update;
  current_value:=public.get_automation_configuration(p_user_id);
  if p_revision is null or current_value->>'revision' is distinct from p_revision then raise exception 'SETTINGS_CHANGED'; end if;
  if p_settings is null or octet_length(p_settings::text)>65536 or not extensions.jsonb_matches_schema(
    '{"type":"object","additionalProperties":false,"required":["execution","processingScope","excludedAddresses","excludedDomains","policy"],"properties":{"execution":{"type":"object","additionalProperties":false,"required":["automationEnabled","pollIntervalSeconds","maxDailyDrafts"],"properties":{"automationEnabled":{"type":"boolean"},"pollIntervalSeconds":{"type":"integer","minimum":60,"maximum":86400},"maxDailyDrafts":{"type":"integer","minimum":0,"maximum":1000}}},"processingScope":{"enum":["ALL_INCOMING","INBOX","UNREAD_INBOX"]},"excludedAddresses":{"type":"array","maxItems":100,"uniqueItems":true,"items":{"type":"string","maxLength":254}},"excludedDomains":{"type":"array","maxItems":100,"uniqueItems":true,"items":{"type":"string","maxLength":253}},"policy":{"type":"object"}}}',p_settings)
    then raise exception 'INVALID_INPUT' using errcode='23514'; end if;
  perform public.set_response_policy(p_user_id,p_settings->'policy');
  update public.user_settings set
    automation_enabled=(p_settings->'execution'->>'automationEnabled')::boolean,
    poll_interval_seconds=(p_settings->'execution'->>'pollIntervalSeconds')::integer,
    max_daily_drafts=(p_settings->'execution'->>'maxDailyDrafts')::integer,
    processing_scope=p_settings->>'processingScope',
    classifier_excluded_addresses=array(select jsonb_array_elements_text(p_settings->'excludedAddresses')),
    classifier_excluded_domains=array(select jsonb_array_elements_text(p_settings->'excludedDomains'))
    where user_id=p_user_id;
  return public.get_automation_configuration(p_user_id);
end;
$$;
revoke all on function public.get_automation_configuration(uuid),public.set_automation_configuration(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_automation_configuration(uuid),public.set_automation_configuration(uuid,text,jsonb) to service_role;
