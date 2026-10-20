create function public.valid_style_scope(kind text, key text) returns boolean
language sql immutable strict set search_path = '' as $$
  select case kind
    when 'GENERAL' then key = ''
    when 'RECIPIENT' then char_length(key) <= 254 and key = lower(key) and key ~ '^[^[:space:]<>@]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$'
    when 'DOMAIN' then char_length(key) <= 253 and key = lower(key) and key ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$'
    when 'RELATIONSHIP' then key in ('CLIENT','COLLEAGUE','SUPPLIER','MANAGEMENT','OTHER')
    else false end;
$$;
revoke all on function public.valid_style_scope(text,text) from public, anon, authenticated;
grant execute on function public.valid_style_scope(text,text) to service_role;

alter table public.style_profiles
  add column scope_kind text not null default 'GENERAL',
  add column scope_key text not null default '',
  add column parent_revision uuid,
  add column context_evidence jsonb not null default '{}',
  add column relationship_rule_revisions uuid[] not null default '{}',
  add column generated_at timestamptz not null default now();
alter table public.style_profiles drop constraint style_profiles_gmail_account_id_key;
alter table public.style_profiles add constraint style_profiles_scope_key unique (gmail_account_id,scope_kind,scope_key);
alter table public.style_profiles add constraint style_profiles_scope_check check (public.valid_style_scope(scope_kind,scope_key));
alter table public.style_profiles add constraint style_profiles_rule_revisions_check check (
  (scope_kind='RELATIONSHIP' and cardinality(relationship_rule_revisions) between 1 and 200 and array_position(relationship_rule_revisions,null) is null)
  or (scope_kind<>'RELATIONSHIP' and cardinality(relationship_rule_revisions)=0)
);
alter table public.style_profiles add constraint style_profiles_context_check check (
  case when scope_kind='GENERAL' then parent_revision is null and context_evidence='{}'::jsonb
  when extensions.jsonb_matches_schema('{"type":"object","required":["threads","recipients","words","days"],"additionalProperties":false,"properties":{"threads":{"type":"integer","minimum":3,"maximum":500},"recipients":{"type":"integer","minimum":1,"maximum":500},"words":{"type":"integer","minimum":120,"maximum":5000000},"days":{"type":"integer","minimum":2,"maximum":500}}}',context_evidence)
  then parent_revision is not null and profile->>'schema_version'='2' and sample_size>=10
    and (context_evidence->>'threads')::integer <= sample_size
    and (context_evidence->>'days')::integer <= sample_size
    and (context_evidence->>'recipients')::integer <= sample_size
    and (scope_kind<>'RECIPIENT' or (context_evidence->>'recipients')::integer=1)
    and (scope_kind<>'DOMAIN' or (context_evidence->>'recipients')::integer>=3)
    and (scope_kind<>'RELATIONSHIP' or (context_evidence->>'recipients')::integer>=2)
  else false end
);
create or replace function public.version_style_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    new.version := 1;
    new.generated_at := clock_timestamp();
  else
    if row(new.user_id,new.gmail_account_id,new.scope_kind,new.scope_key) is distinct from row(old.user_id,old.gmail_account_id,old.scope_kind,old.scope_key) then
      raise exception using errcode='23514', message='PROFILE_OWNER_IMMUTABLE';
    end if;
    new.created_at := old.created_at;
    if new.revision is distinct from old.revision
      or row(new.profile,new.model,new.prompt_version,new.sample_size,new.input_tokens,new.output_tokens,new.warnings,new.origin,new.source_message_ids,new.parent_revision,new.context_evidence,new.relationship_rule_revisions)
        is distinct from row(old.profile,old.model,old.prompt_version,old.sample_size,old.input_tokens,old.output_tokens,old.warnings,old.origin,old.source_message_ids,old.parent_revision,old.context_evidence,old.relationship_rule_revisions) then
      new.version := old.version+1;
      new.revision := gen_random_uuid();
      new.generated_at := clock_timestamp();
      new.review_status := 'UNREVIEWED';
      new.reviewed_at := null;
    else
      new.version := old.version;
      new.generated_at := old.generated_at;
    end if;
  end if;
  return new;
end;
$$;

create table public.style_relationships (
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  match_kind text not null check (match_kind in ('RECIPIENT','DOMAIN')),
  match_key text not null,
  category text not null check (category in ('CLIENT','COLLEAGUE','SUPPLIER','MANAGEMENT','OTHER')),
  revision uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gmail_account_id,match_kind,match_key),
  constraint style_relationships_owner_fkey foreign key (gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  constraint style_relationships_match_check check (public.valid_style_scope(match_kind,match_key))
);
create index style_relationships_user_id_idx on public.style_relationships(user_id);
alter table public.style_relationships enable row level security;
revoke all on public.style_relationships from public,anon,authenticated;
grant select on public.style_relationships to authenticated;
grant select,insert,update,delete on public.style_relationships to service_role;
create policy style_relationships_select_own on public.style_relationships for select to authenticated using (
  (select auth.uid())=user_id
  and (select exists(select 1 from public.users where id=(select auth.uid()) and status='ACTIVE'))
  and exists(select 1 from public.gmail_accounts a where a.id=gmail_account_id and a.user_id=(select auth.uid()) and a.status='CONNECTED')
);
create trigger style_relationships_updated_at before update on public.style_relationships for each row execute function public.touch_updated_at();
create function public.version_style_relationship() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.category is distinct from old.category then new.revision:=gen_random_uuid();
  else new.revision:=old.revision; end if;
  return new;
end;
$$;
revoke all on function public.version_style_relationship() from public,anon,authenticated;
grant execute on function public.version_style_relationship() to service_role;
create trigger style_relationships_version before update on public.style_relationships for each row execute function public.version_style_relationship();
create function public.invalidate_relationship_styles() returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP='UPDATE' then
    if row(new.user_id,new.gmail_account_id,new.match_kind,new.match_key) is distinct from row(old.user_id,old.gmail_account_id,old.match_kind,old.match_key) then
      raise exception using errcode='23514', message='RELATIONSHIP_OWNER_IMMUTABLE';
    end if;
    if new.category=old.category then return new; end if;
  end if;
  delete from public.style_profiles where gmail_account_id=coalesce(new.gmail_account_id,old.gmail_account_id) and scope_kind='RELATIONSHIP';
  return coalesce(new,old);
end;
$$;
revoke all on function public.invalidate_relationship_styles() from public,anon,authenticated;
grant execute on function public.invalidate_relationship_styles() to service_role;
create trigger style_relationships_invalidate after insert or update on public.style_relationships for each row execute function public.invalidate_relationship_styles();
