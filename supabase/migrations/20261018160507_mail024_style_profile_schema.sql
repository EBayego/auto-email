create extension if not exists pg_jsonschema with schema extensions;

alter table public.style_profiles
  add column version integer not null default 1 check (version >= 1),
  add column origin text not null default 'SENT_HISTORY' check (origin = 'SENT_HISTORY'),
  add column source_message_ids text[] not null default '{}';

alter table public.style_profiles drop constraint style_profiles_profile_check;
alter table public.style_profiles add constraint style_profiles_profile_check check (
  octet_length(profile::text) <= 16384
  and extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","oneOf":[{"type":"object","properties":{"schema_version":{"type":"number","const":1},"language":{"type":"string","maxLength":16,"pattern":"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$"},"formality":{"type":"string","enum":["low","medium","high","mixed"]},"average_length":{"type":"string","enum":["short","medium","long","mixed"]},"preferred_greetings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"preferred_closings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"vocabulary":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"structure":{"type":"string","minLength":1,"maxLength":400},"punctuation":{"type":"string","minLength":1,"maxLength":240},"uses_emojis":{"type":"boolean"},"style_description":{"type":"string","minLength":1,"maxLength":600}},"required":["schema_version","language","formality","average_length","preferred_greetings","preferred_closings","vocabulary","structure","punctuation","uses_emojis","style_description"],"additionalProperties":false},{"type":"object","properties":{"schema_version":{"type":"number","const":2},"language":{"type":"string","maxLength":16,"pattern":"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$"},"formality":{"type":"string","enum":["low","medium","high","mixed"]},"average_length":{"type":"string","enum":["short","medium","long","mixed"]},"preferred_greetings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"preferred_closings":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"vocabulary":{"maxItems":5,"type":"array","items":{"type":"string","minLength":1,"maxLength":60}},"structure":{"type":"string","minLength":1,"maxLength":400},"punctuation":{"type":"string","minLength":1,"maxLength":240},"uses_emojis":{"type":"boolean"},"style_description":{"type":"string","minLength":1,"maxLength":600},"form_of_address":{"type":"string","enum":["informal","formal","neutral","mixed","unknown"]},"tone":{"type":"object","properties":{"warmth":{"type":"string","enum":["reserved","neutral","warm","mixed","unknown"]},"directness":{"type":"string","enum":["direct","balanced","indirect","mixed","unknown"]}},"required":["warmth","directness"],"additionalProperties":false},"structure_traits":{"type":"object","properties":{"sentence_length":{"type":"string","enum":["short","medium","long","mixed","unknown"]},"paragraph_length":{"type":"string","enum":["short","medium","long","mixed","unknown"]},"lists":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]}},"required":["sentence_length","paragraph_length","lists"],"additionalProperties":false},"punctuation_traits":{"type":"object","properties":{"exclamations":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]},"ellipses":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]},"semicolons":{"type":"string","enum":["none","occasional","frequent","mixed","unknown"]}},"required":["exclamations","ellipses","semicolons"],"additionalProperties":false}},"required":["schema_version","language","formality","average_length","preferred_greetings","preferred_closings","vocabulary","structure","punctuation","uses_emojis","style_description","form_of_address","tone","structure_traits","punctuation_traits"],"additionalProperties":false}]}'::json, profile)
);
alter table public.style_profiles drop constraint style_profiles_prompt_version_check;
alter table public.style_profiles add constraint style_profiles_prompt_version_check check (
  (profile->>'schema_version' = '1' and prompt_version = 'mail018-v1')
  or (profile->>'schema_version' = '2' and prompt_version = 'mail024-v2')
);

create function public.valid_style_profile_sources(ids text[], expected integer, legacy boolean)
returns boolean language sql immutable strict set search_path = '' as $$
  select (cardinality(ids) = expected or (legacy and cardinality(ids) = 0))
    and cardinality(ids) <= 500
    and coalesce(array_ndims(ids), 1) = 1
    and not exists(select 1 from unnest(ids) id where id is null or char_length(id) not between 1 and 512 or id !~ '^[A-Za-z0-9_-]+$')
    and cardinality(ids) = (select count(distinct id) from unnest(ids) id);
$$;
revoke all on function public.valid_style_profile_sources(text[], integer, boolean) from public, anon, authenticated;
grant execute on function public.valid_style_profile_sources(text[], integer, boolean) to service_role;
alter table public.style_profiles add constraint style_profiles_sources_check check (
  public.valid_style_profile_sources(source_message_ids, sample_size, profile->>'schema_version' = '1')
);

create function public.version_style_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    new.version := 1;
  else
    if row(new.user_id, new.gmail_account_id) is distinct from row(old.user_id, old.gmail_account_id) then
      raise exception using errcode = '23514', message = 'PROFILE_OWNER_IMMUTABLE';
    end if;
    new.created_at := old.created_at;
    if new.revision is distinct from old.revision
      or row(new.profile, new.model, new.prompt_version, new.sample_size, new.input_tokens, new.output_tokens, new.warnings, new.origin, new.source_message_ids)
        is distinct from row(old.profile, old.model, old.prompt_version, old.sample_size, old.input_tokens, old.output_tokens, old.warnings, old.origin, old.source_message_ids) then
      new.version := old.version + 1;
      new.revision := gen_random_uuid();
      new.review_status := 'UNREVIEWED';
      new.reviewed_at := null;
    else
      new.version := old.version;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.version_style_profile() from public, anon, authenticated;
grant execute on function public.version_style_profile() to service_role;
create trigger style_profiles_version before insert or update on public.style_profiles
for each row execute function public.version_style_profile();
