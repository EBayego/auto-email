alter table "public"."user_settings" add column "classifier_excluded_addresses" text[] not null default '{}'::text[];

alter table "public"."user_settings" add column "classifier_excluded_domains" text[] not null default '{}'::text[];

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.valid_classifier_exclusions(p_addresses text[], p_domains text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_addresses is not null and p_domains is not null
    and coalesce(array_ndims(p_addresses), 1) = 1 and coalesce(array_ndims(p_domains), 1) = 1
    and cardinality(p_addresses) <= 100 and cardinality(p_domains) <= 100
    and array_position(p_addresses, null::text) is null and array_position(p_domains, null::text) is null
    and not exists (
      select 1 from unnest(p_addresses) address
      where char_length(address) not between 3 and 254 or address <> lower(address)
        or address !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[^[:space:]<>@]+$'
    )
    and not exists (
      select 1 from unnest(p_domains || array(select split_part(a, '@', 2) from unnest(p_addresses) a)) domain
      where char_length(domain) not between 1 and 253 or domain <> lower(domain)
        or exists (select 1 from unnest(string_to_array(domain, '.')) label
          where label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
    );
$function$
;

revoke all on function public.valid_classifier_exclusions(text[], text[]) from public, anon, authenticated;
grant execute on function public.valid_classifier_exclusions(text[], text[]) to service_role;

alter table public.user_settings add constraint user_settings_classifier_exclusions_check
  check (public.valid_classifier_exclusions(classifier_excluded_addresses, classifier_excluded_domains)) not valid;
alter table public.user_settings validate constraint user_settings_classifier_exclusions_check;

grant select (classifier_excluded_addresses, classifier_excluded_domains) on public.user_settings to authenticated;


