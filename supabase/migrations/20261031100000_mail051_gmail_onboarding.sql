create function public.valid_onboarding_scope(value jsonb) returns boolean
language plpgsql stable set search_path='' as $$
begin
  if value is null or octet_length(value::text)>16384 or not extensions.jsonb_matches_schema(
    '{"type":"object","additionalProperties":false,"required":["after","before","maxCandidates","excludedAddresses","excludedDomains"],"properties":{"after":{"type":"string","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},"before":{"type":"string","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},"maxCandidates":{"type":"integer","enum":[200,500]},"excludedAddresses":{"type":"array","maxItems":100,"uniqueItems":true,"items":{"type":"string","maxLength":254,"pattern":"^[^\\s<>@]+@[^\\s<>@]+[.][^\\s<>@]+$"}},"excludedDomains":{"type":"array","maxItems":100,"uniqueItems":true,"items":{"type":"string","maxLength":253,"pattern":"^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$"}}}}', value) then return false; end if;
  return (value->>'after')::date >= date '1970-01-02' and (value->>'after')::date < (value->>'before')::date;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;

create table public.gmail_onboarding (
  user_id uuid primary key references public.users(id) on delete cascade,
  consent_revision uuid not null default gen_random_uuid(),
  consent_version text not null check(consent_version='mail051-v1'),
  consented_at timestamptz not null default clock_timestamp(),
  scope jsonb not null check(public.valid_onboarding_scope(scope)),
  gmail_account_id uuid,
  status text not null default 'CONSENTED' check(status in ('CONSENTED','QUEUED','SAMPLING','ANALYZING','COMPLETED','FAILED','CANCELLED')),
  scanned integer not null default 0 check(scanned between 0 and 500),
  selected integer not null default 0 check(selected between 0 and 200 and selected<=scanned),
  profile_revision uuid,
  error_code text check(error_code in ('EMPTY_SAMPLE','REAUTH_REQUIRED','NOT_CONNECTED','ANALYSIS_INTERRUPTED','PROVIDER_UNAVAILABLE','INVALID_PROFILE','CANCELLED','UNAVAILABLE')),
  lease_id uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  check ((status in ('SAMPLING','ANALYZING')) = (lease_id is not null and lease_expires_at is not null)),
  check ((lease_id is null) = (lease_expires_at is null)),
  check(status<>'COMPLETED' or (profile_revision is not null and selected>0 and finished_at is not null)),
  check(status<>'FAILED' or error_code is not null)
);
create trigger gmail_onboarding_updated before update on public.gmail_onboarding for each row execute function public.touch_updated_at();
create index gmail_onboarding_queue_idx on public.gmail_onboarding(consented_at,user_id) where status='QUEUED';
create index gmail_onboarding_account_idx on public.gmail_onboarding(gmail_account_id,user_id) where gmail_account_id is not null;
alter table public.gmail_onboarding enable row level security;
revoke all on public.gmail_onboarding from anon,authenticated;
grant select(user_id,consent_revision,consent_version,consented_at,scope,gmail_account_id,status,scanned,selected,profile_revision,error_code,lease_expires_at,started_at,finished_at,updated_at) on public.gmail_onboarding to authenticated;
grant all on public.gmail_onboarding to service_role;
create policy gmail_onboarding_own on public.gmail_onboarding for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.users where id=(select auth.uid()) and status='ACTIVE')
);

create function public.save_onboarding_consent(p_user_id uuid,p_scope jsonb,p_version text,p_consented boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_consented is distinct from true or p_version is distinct from 'mail051-v1' then raise exception 'CONSENT_REQUIRED'; end if;
  if not public.valid_onboarding_scope(p_scope) or (p_scope->>'before')::date>(clock_timestamp() at time zone 'UTC')::date then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.gmail_onboarding where user_id=p_user_id and (status='QUEUED' or (status in ('SAMPLING','ANALYZING') and lease_expires_at>clock_timestamp()));
  if found then raise exception 'ANALYSIS_BUSY'; end if;
  insert into public.gmail_onboarding(user_id,scope,consent_version) values(p_user_id,p_scope,p_version)
    on conflict(user_id) do update set scope=excluded.scope,consent_version=excluded.consent_version,
      consent_revision=gen_random_uuid(),consented_at=clock_timestamp(),gmail_account_id=null,status='CONSENTED',
      scanned=0,selected=0,profile_revision=null,error_code=null,lease_id=null,lease_expires_at=null,started_at=null,finished_at=null;
  return true;
end;
$$;

create function public.control_onboarding_analysis(p_user_id uuid,p_revision uuid,p_action text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.gmail_onboarding%rowtype; a public.gmail_accounts%rowtype;
begin
  if p_action is null or p_action not in ('START','CANCEL') then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  select * into a from public.gmail_accounts where user_id=p_user_id for share;
  select * into o from public.gmail_onboarding where user_id=p_user_id for update;
  if not found or o.consent_version<>'mail051-v1' then raise exception 'CONSENT_REQUIRED'; end if;
  if p_revision is distinct from o.consent_revision then raise exception 'STALE_CONSENT'; end if;
  if p_action='CANCEL' then
    update public.gmail_onboarding set status='CANCELLED',error_code='CANCELLED',finished_at=clock_timestamp(),lease_id=null,lease_expires_at=null
      where user_id=p_user_id and status in ('QUEUED','SAMPLING','ANALYZING');
    return true;
  end if;
  if a.id is null or a.status<>'CONNECTED' then raise exception 'NOT_CONNECTED'; end if;
  if o.status in ('QUEUED','COMPLETED') or (o.status in ('SAMPLING','ANALYZING') and o.lease_expires_at>clock_timestamp()) then return true; end if;
  update public.gmail_onboarding set status='QUEUED',gmail_account_id=a.id,scanned=0,selected=0,error_code=null,profile_revision=null,
    lease_id=null,lease_expires_at=null,started_at=null,finished_at=null where user_id=p_user_id;
  return true;
end;
$$;

create function public.claim_onboarding_analysis() returns setof public.gmail_onboarding
language plpgsql security invoker set search_path='' as $$
declare owner uuid;
begin
  update public.gmail_onboarding set status='FAILED',error_code='ANALYSIS_INTERRUPTED',finished_at=clock_timestamp(),lease_id=null,lease_expires_at=null
    where status in ('SAMPLING','ANALYZING') and lease_expires_at<=clock_timestamp();
  select o.user_id into owner from public.gmail_onboarding o join public.users u on u.id=o.user_id
    join public.gmail_accounts a on a.id=o.gmail_account_id and a.user_id=o.user_id
    where o.status='QUEUED' and o.consent_version='mail051-v1' and a.status='CONNECTED' and u.status='ACTIVE'
    order by o.consented_at,o.user_id limit 1 for update of o skip locked;
  if not found then return; end if;
  return query update public.gmail_onboarding set status='SAMPLING',lease_id=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',
    started_at=clock_timestamp(),finished_at=null,error_code=null where user_id=owner returning *;
end;
$$;

create function public.advance_onboarding_analysis(p_user_id uuid,p_lease_id uuid,p_phase text,p_scanned integer,p_selected integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_phase is null or p_phase not in ('SAMPLING','ANALYZING') or p_scanned is null or p_scanned not between 0 and 500
    or p_selected is null or p_selected not between 0 and least(200,p_scanned) then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  perform 1 from public.gmail_accounts where user_id=p_user_id and status='CONNECTED' for share;
  if not found then return false; end if;
  update public.gmail_onboarding o set status=p_phase,scanned=greatest(o.scanned,p_scanned),selected=greatest(o.selected,p_selected),
    lease_expires_at=clock_timestamp()+interval '5 minutes'
    where o.user_id=p_user_id and o.lease_id=p_lease_id and o.lease_expires_at>clock_timestamp()
      and o.consent_version='mail051-v1' and o.status in ('SAMPLING','ANALYZING') and (o.status<>'ANALYZING' or p_phase='ANALYZING')
      and exists(select 1 from public.gmail_accounts a where a.id=o.gmail_account_id and a.user_id=o.user_id and a.status='CONNECTED');
  return found;
end;
$$;

create function public.finish_onboarding_analysis(p_user_id uuid,p_lease_id uuid,p_error text default null,p_generation jsonb default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.gmail_onboarding%rowtype; revision uuid;
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  perform 1 from public.gmail_accounts where user_id=p_user_id and status='CONNECTED' for share;
  if not found then return false; end if;
  select * into o from public.gmail_onboarding where user_id=p_user_id and lease_id=p_lease_id and lease_expires_at>clock_timestamp()
    and consent_version='mail051-v1' and status in ('SAMPLING','ANALYZING') for update;
  if not found then return false; end if;
  if p_error is not null then
    update public.gmail_onboarding set status='FAILED',error_code=p_error,lease_id=null,lease_expires_at=null,finished_at=clock_timestamp() where user_id=p_user_id;
    return true;
  end if;
  if o.status<>'ANALYZING' or p_generation is null or (p_generation->>'sampleSize')::integer is distinct from o.selected then raise exception 'INVALID_INPUT'; end if;
  insert into public.style_profiles(user_id,gmail_account_id,scope_kind,scope_key,revision,profile,model,prompt_version,sample_size,input_tokens,output_tokens,warnings,source_message_ids)
    values(p_user_id,o.gmail_account_id,'GENERAL','',gen_random_uuid(),p_generation->'profile',p_generation->>'model',p_generation->>'promptVersion',
      (p_generation->>'sampleSize')::integer,(p_generation->>'inputTokens')::integer,(p_generation->>'outputTokens')::integer,
      array(select jsonb_array_elements_text(p_generation->'warnings')),array(select jsonb_array_elements_text(p_generation->'sourceMessageIds')))
    on conflict(gmail_account_id,scope_kind,scope_key) do update set revision=excluded.revision,profile=excluded.profile,model=excluded.model,
      prompt_version=excluded.prompt_version,sample_size=excluded.sample_size,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,
      warnings=excluded.warnings,source_message_ids=excluded.source_message_ids,review_status='UNREVIEWED',reviewed_at=null returning style_profiles.revision into revision;
  update public.gmail_onboarding set status='COMPLETED',profile_revision=revision,error_code=null,lease_id=null,lease_expires_at=null,finished_at=clock_timestamp() where user_id=p_user_id;
  return true;
end;
$$;

create function public.cancel_unavailable_onboarding() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (tg_table_name='gmail_accounts' and new.status<>'CONNECTED') or (tg_table_name='users' and new.status<>'ACTIVE') then
    update public.gmail_onboarding set status='CANCELLED',error_code='NOT_CONNECTED',finished_at=clock_timestamp(),lease_id=null,lease_expires_at=null
      where user_id=coalesce((to_jsonb(new)->>'user_id')::uuid,new.id) and status in ('QUEUED','SAMPLING','ANALYZING');
  end if;
  return new;
end;
$$;
create trigger gmail_accounts_cancel_onboarding after update of status on public.gmail_accounts for each row execute function public.cancel_unavailable_onboarding();
create trigger users_cancel_onboarding after update of status on public.users for each row execute function public.cancel_unavailable_onboarding();

revoke all on function public.valid_onboarding_scope(jsonb),public.save_onboarding_consent(uuid,jsonb,text,boolean),
  public.control_onboarding_analysis(uuid,uuid,text),public.claim_onboarding_analysis(),public.advance_onboarding_analysis(uuid,uuid,text,integer,integer),
  public.finish_onboarding_analysis(uuid,uuid,text,jsonb),public.cancel_unavailable_onboarding() from public,anon,authenticated;
grant execute on function public.valid_onboarding_scope(jsonb),public.save_onboarding_consent(uuid,jsonb,text,boolean),
  public.control_onboarding_analysis(uuid,uuid,text),public.claim_onboarding_analysis(),public.advance_onboarding_analysis(uuid,uuid,text,integer,integer),
  public.finish_onboarding_analysis(uuid,uuid,text,jsonb),public.cancel_unavailable_onboarding() to service_role;
