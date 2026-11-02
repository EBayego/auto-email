alter table public.style_profiles add constraint style_profiles_learning_owner_key unique(id,user_id,gmail_account_id);
create table public.style_learning_settings (
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid primary key,
  auto_remove_salutations boolean not null default false,
  revision uuid not null default gen_random_uuid(),
  authorized_at timestamptz,
  foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  check((auto_remove_salutations and authorized_at is not null) or (not auto_remove_salutations and authorized_at is null))
);
create index style_learning_settings_owner_idx on public.style_learning_settings(user_id);
create index style_learning_settings_account_owner_idx on public.style_learning_settings(gmail_account_id,user_id);
create table public.style_learning_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  profile_id uuid not null,
  base_revision uuid not null,
  general_revision uuid not null,
  base_version integer not null check(base_version>0),
  feature text not null check(feature in ('greeting','closing')),
  category text not null check(category in ('NONE','SHORT','FORMAL','GRATITUDE','WARM') and (feature='closing' or category in ('NONE','SHORT','FORMAL'))),
  status text not null default 'PENDING' check(status in ('PENDING','APPLIED','REJECTED','STALE','REVERTED')),
  feedback_ids uuid[] not null check(cardinality(feedback_ids) between 3 and 100 and array_position(feedback_ids,null) is null),
  support integer not null check(support between 3 and 100),
  total integer not null check(total between 3 and 100 and total>=support),
  threads integer not null check(threads between 3 and 100),
  days integer not null check(days between 2 and 31),
  audiences integer not null check(audiences between 1 and 100),
  first_feedback_at timestamptz not null,
  before_profile jsonb,
  applied_revision uuid,
  applied_version integer,
  automatic boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  reverted_revision uuid,
  foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  foreign key(profile_id,user_id,gmail_account_id) references public.style_profiles(id,user_id,gmail_account_id) on delete cascade,
  unique(profile_id,base_revision,feature,category),
  check(support=cardinality(feedback_ids)),
  check((status in ('APPLIED','REVERTED') and before_profile is not null and applied_revision is not null and applied_version>base_version and decided_at is not null)
    or (status not in ('APPLIED','REVERTED') and before_profile is null and applied_revision is null and applied_version is null)),
  check(before_profile is null or octet_length(before_profile::text)<=16384)
);
create index style_learning_proposals_account_owner_idx on public.style_learning_proposals(gmail_account_id,user_id);
create index style_learning_proposals_profile_owner_idx on public.style_learning_proposals(profile_id,user_id,gmail_account_id);
create index style_learning_proposals_owner_idx on public.style_learning_proposals(user_id,created_at desc);
create index style_learning_proposals_pending_idx on public.style_learning_proposals(created_at,id) where status='PENDING';
create index generation_runs_style_learning_idx on public.generation_runs(user_id,gmail_account_id,(configuration->>'styleRevision'));
alter table public.style_learning_settings enable row level security;
alter table public.style_learning_proposals enable row level security;
revoke all on public.style_learning_settings,public.style_learning_proposals from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.style_learning_settings,public.style_learning_proposals to service_role;
-- The web uses checked server access; snapshots and internal evidence are not public API tables.

create function public.style_learning_phrases(p_feature text,p_category text,p_language text) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select case when p_category='NONE' then '[]'::jsonb else to_jsonb(array[case split_part(p_language,'-',1)
    when 'es' then case when p_feature='greeting' then case p_category when 'SHORT' then 'Hola' when 'FORMAL' then 'Estimado' end else case p_category when 'SHORT' then 'Un saludo' when 'FORMAL' then 'Atentamente' when 'GRATITUDE' then 'Gracias' when 'WARM' then 'Un abrazo' end end
    when 'en' then case when p_feature='greeting' then case p_category when 'SHORT' then 'Hello' when 'FORMAL' then 'Dear' end else case p_category when 'SHORT' then 'Kind regards' when 'FORMAL' then 'Sincerely' when 'GRATITUDE' then 'Thank you' when 'WARM' then 'Best wishes' end end
    when 'fr' then case when p_feature='greeting' then case p_category when 'SHORT' then 'Bonjour' when 'FORMAL' then 'Madame Monsieur' end else case p_category when 'SHORT' then 'Cordialement' when 'FORMAL' then 'Respectueusement' when 'GRATITUDE' then 'Merci' when 'WARM' then 'Amicalement' end end
    when 'de' then case when p_feature='greeting' then case p_category when 'SHORT' then 'Hallo' when 'FORMAL' then 'Guten Tag' end else case p_category when 'SHORT' then 'Viele Grüße' when 'FORMAL' then 'Hochachtungsvoll' when 'GRATITUDE' then 'Vielen Dank' when 'WARM' then 'Herzliche Grüße' end end
    when 'it' then case when p_feature='greeting' then case p_category when 'SHORT' then 'Ciao' when 'FORMAL' then 'Gentile' end else case p_category when 'SHORT' then 'Cordiali saluti' when 'FORMAL' then 'Distinti saluti' when 'GRATITUDE' then 'Grazie' when 'WARM' then 'Un abbraccio' end end
    when 'pt' then case when p_feature='greeting' then case p_category when 'SHORT' then 'Olá' when 'FORMAL' then 'Prezado' end else case p_category when 'SHORT' then 'Cumprimentos' when 'FORMAL' then 'Atenciosamente' when 'GRATITUDE' then 'Obrigado' when 'WARM' then 'Um abraço' end end
    when 'ca' then case when p_feature='greeting' then case p_category when 'SHORT' then 'Hola' when 'FORMAL' then 'Benvolgut' end else case p_category when 'SHORT' then 'Salutacions' when 'FORMAL' then 'Atentament' when 'GRATITUDE' then 'Gràcies' when 'WARM' then 'Una abraçada' end end
  end]) end;
$$;
create function public.style_learning_evidence(p_profile_id uuid,p_feature text,p_category text) returns jsonb
language sql stable security invoker set search_path='' as $$
  with recent as (
    select f.id,d.thread_id,d.delivery_envelope_hash,f.sent_at,f.metrics,
      f.metrics->>case p_feature when 'greeting' then 'sentGreeting' else 'sentClosing' end as target,
      f.metrics->>case p_feature when 'greeting' then 'originalGreeting' else 'originalClosing' end as original,
      f.metrics->>case p_feature when 'greeting' then 'greetingChanged' else 'closingChanged' end as changed
    from public.style_profiles p join public.generation_runs r on r.user_id=p.user_id and r.gmail_account_id=p.gmail_account_id and r.configuration->>'styleRevision'=p.revision::text
      join public.feedback_events f on f.generation_run_id=r.id and f.user_id=p.user_id and f.gmail_account_id=p.gmail_account_id
      join public.draft_generations d on d.id=f.draft_generation_id
    where p.id=p_profile_id and f.status='COMPLETED' and f.algorithm_version='mail058-v1' and f.sent_at>now()-interval '30 days'
    order by f.sent_at desc,f.id limit 100
  ), supporting as (
    select * from recent where changed='true' and target=p_category and original<>target
      and metrics->>'classification'='STYLE_ONLY' and metrics->>'learningEligible'='true' and metrics->'factualSignals'='[]'::jsonb and metrics->>'attachmentsChanged'='false'
      and delivery_envelope_hash is not null
  ) select jsonb_build_object('support',count(*),'total',(select count(*) from recent),'threads',count(distinct thread_id),
    'days',count(distinct (sent_at at time zone 'UTC')::date),'audiences',count(distinct delivery_envelope_hash),
    'feedbackIds',coalesce(jsonb_agg(id order by id),'[]'::jsonb),'firstFeedbackAt',min(sent_at)) from supporting;
$$;
create function public.style_learning_evidence_valid(p_evidence jsonb,p_general boolean) returns boolean
language sql immutable security invoker set search_path='' as $$
  select coalesce((p_evidence->>'support')::integer>=case when p_general then 5 else 3 end
    and (p_evidence->>'threads')::integer>=3 and (p_evidence->>'days')::integer>=2
    and (p_evidence->>'support')::integer*5 >= (p_evidence->>'total')::integer*4
    and (p_evidence->>'audiences')::integer>=case when p_general then 3 else 1 end,false);
$$;
create function public.style_learning_profile_current(p_profile public.style_profiles,p_general public.style_profiles) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce((p_profile).review_status='CONFIRMED' and (p_general).review_status='CONFIRMED'
    and ((p_profile).scope_kind='GENERAL' or ((p_profile).parent_revision=(p_general).revision
      and (p_profile).generated_at>now()-interval '90 days' and (p_profile).generated_at<=now()+interval '5 seconds'
      and ((p_profile).scope_kind<>'RELATIONSHIP' or (select coalesce(array_agg(v order by v),'{}'::uuid[]) from unnest((p_profile).relationship_rule_revisions) v)
        =(select coalesce(array_agg(revision order by revision),'{}'::uuid[]) from public.style_relationships where gmail_account_id=(p_profile).gmail_account_id and user_id=(p_profile).user_id)))),false);
$$;
create function public.decide_style_learning(p_user_id uuid,p_account_id uuid,p_proposal_id uuid,p_expected_revision uuid,p_action text,p_automatic boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
declare proposal public.style_learning_proposals%rowtype; target public.style_profiles%rowtype; general public.style_profiles%rowtype;
  setting public.style_learning_settings%rowtype; evidence jsonb; phrases jsonb; field text; after_revision uuid; after_version integer; saved_profile jsonb;
begin
  if p_action is null or p_action not in ('ACCEPT','REJECT','REVERT') or p_expected_revision is null or p_automatic is null then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED' for update;
  if not found then raise exception 'NOT_CONNECTED'; end if;
  select * into proposal from public.style_learning_proposals where id=p_proposal_id and user_id=p_user_id and gmail_account_id=p_account_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into general from public.style_profiles where user_id=p_user_id and gmail_account_id=p_account_id and scope_kind='GENERAL' for update;
  select * into target from public.style_profiles where id=proposal.profile_id and user_id=p_user_id and gmail_account_id=p_account_id for update;
  if not found or target.revision<>p_expected_revision then raise exception 'STALE_STYLE'; end if;
  if p_action='REVERT' then
    if p_automatic or proposal.status<>'APPLIED' or target.revision<>proposal.applied_revision then raise exception 'STALE_STYLE'; end if;
    update public.style_profiles set profile=proposal.before_profile where id=target.id returning revision,version into after_revision,after_version;
    update public.style_profiles set review_status='CONFIRMED',reviewed_at=clock_timestamp() where id=target.id;
    update public.style_learning_proposals set status='REVERTED',reverted_revision=after_revision where id=proposal.id;
    return true;
  end if;
  if proposal.status<>'PENDING' or target.revision<>proposal.base_revision or general.revision<>proposal.general_revision then raise exception 'STALE_STYLE'; end if;
  if p_action='REJECT' then
    if p_automatic then raise exception 'INVALID_INPUT'; end if;
    update public.style_learning_proposals set status='REJECTED',decided_at=clock_timestamp() where id=proposal.id;
    return true;
  end if;
  if public.style_learning_profile_current(target,general) is distinct from true or exists(select 1 from public.style_preferences where user_id=p_user_id and gmail_account_id=p_account_id and preference_key=proposal.feature) then raise exception 'STALE_STYLE'; end if;
  evidence:=public.style_learning_evidence(target.id,proposal.feature,proposal.category);
  if not public.style_learning_evidence_valid(evidence,target.scope_kind='GENERAL')
    or not proposal.feedback_ids <@ array(select jsonb_array_elements_text(evidence->'feedbackIds')::uuid) then raise exception 'INSUFFICIENT_EVIDENCE'; end if;
  if p_automatic then
    select * into setting from public.style_learning_settings where user_id=p_user_id and gmail_account_id=p_account_id;
    if setting.auto_remove_salutations is distinct from true or proposal.category<>'NONE' or proposal.first_feedback_at<setting.authorized_at then raise exception 'FORBIDDEN'; end if;
  end if;
  phrases:=public.style_learning_phrases(proposal.feature,proposal.category,target.profile->>'language');
  if phrases is null or phrases @> '[null]'::jsonb then raise exception 'INVALID_INPUT'; end if;
  field:=case proposal.feature when 'greeting' then 'preferred_greetings' else 'preferred_closings' end;
  if target.profile->field=phrases then raise exception 'STALE_STYLE'; end if;
  saved_profile:=target.profile;
  update public.style_profiles set profile=jsonb_set(profile,array[field],phrases) where id=target.id returning revision,version into after_revision,after_version;
  update public.style_profiles set review_status='CONFIRMED',reviewed_at=clock_timestamp() where id=target.id;
  update public.style_learning_proposals set status='APPLIED',before_profile=saved_profile,applied_revision=after_revision,applied_version=after_version,
    automatic=p_automatic,decided_at=clock_timestamp() where id=proposal.id;
  return true;
end;
$$;
create function public.refresh_style_learning(p_limit integer default 20) returns integer language plpgsql security invoker set search_path='' as $$
declare candidate record; profile public.style_profiles%rowtype; general public.style_profiles%rowtype; evidence jsonb; phrases jsonb; created integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
  if not pg_try_advisory_xact_lock(597059) then return 0; end if;
  update public.style_learning_proposals s set status='STALE',decided_at=clock_timestamp() where s.status='PENDING' and
    (s.created_at<clock_timestamp()-interval '30 days' or exists(select 1 from public.style_profiles p where p.id=s.profile_id and p.revision<>s.base_revision));
  for candidate in (
    select candidates.* from (
    select distinct p.id as profile_id,p.scope_kind,s.feature,s.category from public.feedback_events f
      join public.generation_runs r on r.id=f.generation_run_id
      join public.style_profiles p on p.user_id=f.user_id and p.gmail_account_id=f.gmail_account_id and p.revision::text=r.configuration->>'styleRevision'
      join public.users u on u.id=p.user_id and u.status='ACTIVE'
      join public.gmail_accounts a on a.id=p.gmail_account_id and a.user_id=p.user_id and a.status='CONNECTED'
      join public.style_profiles g on g.user_id=p.user_id and g.gmail_account_id=p.gmail_account_id and g.scope_kind='GENERAL'
      cross join lateral (values ('greeting',f.metrics->>'sentGreeting',f.metrics->>'originalGreeting',f.metrics->>'greetingChanged'),('closing',f.metrics->>'sentClosing',f.metrics->>'originalClosing',f.metrics->>'closingChanged')) s(feature,category,original,changed)
    where f.status='COMPLETED' and f.sent_at>clock_timestamp()-interval '30 days' and f.metrics->>'classification'='STYLE_ONLY' and f.metrics->>'learningEligible'='true'
      and s.changed='true' and s.category<>s.original and (s.feature='closing' or s.category in ('NONE','SHORT','FORMAL'))
      and public.style_learning_profile_current(p,g)
      and (s.category='NONE' or split_part(p.profile->>'language','-',1) in ('es','en','fr','de','it','pt','ca'))
      and not exists(select 1 from public.style_preferences pref where pref.user_id=p.user_id and pref.gmail_account_id=p.gmail_account_id and pref.preference_key=s.feature)
      and not exists(select 1 from public.style_learning_proposals old where old.profile_id=p.id and old.base_revision=p.revision and old.feature=s.feature and old.category=s.category)
    ) candidates
    where public.style_learning_evidence_valid(public.style_learning_evidence(candidates.profile_id,candidates.feature,candidates.category),candidates.scope_kind='GENERAL')
    order by candidates.profile_id,candidates.feature,candidates.category limit p_limit
  ) loop
    perform 1 from public.users u join public.style_profiles p on p.user_id=u.id where p.id=candidate.profile_id and u.status='ACTIVE' for share of u;
    if not found then continue; end if;
    perform 1 from public.gmail_accounts a join public.style_profiles p on p.gmail_account_id=a.id and p.user_id=a.user_id where p.id=candidate.profile_id and a.status='CONNECTED' for update of a;
    if not found then continue; end if;
    select * into profile from public.style_profiles where id=candidate.profile_id;
    select * into general from public.style_profiles where user_id=profile.user_id and gmail_account_id=profile.gmail_account_id and scope_kind='GENERAL';
    if not public.style_learning_profile_current(profile,general) or exists(select 1 from public.style_preferences where gmail_account_id=profile.gmail_account_id and user_id=profile.user_id and preference_key=candidate.feature) then continue; end if;
    evidence:=public.style_learning_evidence(profile.id,candidate.feature,candidate.category);
    if not public.style_learning_evidence_valid(evidence,profile.scope_kind='GENERAL') then continue; end if;
    phrases:=public.style_learning_phrases(candidate.feature,candidate.category,profile.profile->>'language');
    if phrases is null or phrases @> '[null]'::jsonb or (profile.profile->(case candidate.feature when 'greeting' then 'preferred_greetings' else 'preferred_closings' end))=phrases then continue; end if;
    insert into public.style_learning_proposals(user_id,gmail_account_id,profile_id,base_revision,general_revision,base_version,feature,category,feedback_ids,support,total,threads,days,audiences,first_feedback_at)
    values(profile.user_id,profile.gmail_account_id,profile.id,profile.revision,general.revision,profile.version,candidate.feature,candidate.category,
      array(select jsonb_array_elements_text(evidence->'feedbackIds')::uuid),(evidence->>'support')::integer,(evidence->>'total')::integer,(evidence->>'threads')::integer,(evidence->>'days')::integer,(evidence->>'audiences')::integer,(evidence->>'firstFeedbackAt')::timestamptz)
    on conflict(profile_id,base_revision,feature,category) do nothing;
    if found then created:=created+1; end if;
  end loop;
  for candidate in (select s.* from public.style_learning_proposals s join public.style_learning_settings settings on settings.gmail_account_id=s.gmail_account_id and settings.user_id=s.user_id
    where s.status='PENDING' and s.category='NONE' and settings.auto_remove_salutations and s.first_feedback_at>=settings.authorized_at order by s.created_at,s.id limit p_limit) loop
    begin
      perform public.decide_style_learning(candidate.user_id,candidate.gmail_account_id,candidate.id,candidate.base_revision,'ACCEPT',true);
    exception when raise_exception then
      if sqlerrm not in ('STALE_STYLE','INSUFFICIENT_EVIDENCE','FORBIDDEN','NOT_CONNECTED','NOT_FOUND') then raise; end if;
      if sqlerrm in ('STALE_STYLE','INSUFFICIENT_EVIDENCE') then
        update public.style_learning_proposals set status='STALE',decided_at=clock_timestamp() where id=candidate.id and status='PENDING';
      end if;
    end;
  end loop;
  return created;
end;
$$;
create function public.set_style_learning_settings(p_user_id uuid,p_account_id uuid,p_enabled boolean,p_expected_revision uuid default null,p_notice_version text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare current_revision uuid;
begin
  if p_enabled is null or p_notice_version is distinct from 'mail059-v1' then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED' for update;
  if not found then raise exception 'NOT_CONNECTED'; end if;
  select revision into current_revision from public.style_learning_settings where user_id=p_user_id and gmail_account_id=p_account_id;
  if current_revision is distinct from p_expected_revision then raise exception 'STALE_STYLE'; end if;
  insert into public.style_learning_settings(user_id,gmail_account_id,auto_remove_salutations,revision,authorized_at)
    values(p_user_id,p_account_id,p_enabled,gen_random_uuid(),case when p_enabled then clock_timestamp() else null end)
    on conflict(gmail_account_id) do update set auto_remove_salutations=excluded.auto_remove_salutations,revision=excluded.revision,authorized_at=excluded.authorized_at;
end;
$$;
create function public.get_style_learning(p_user_id uuid,p_account_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.users where id=p_user_id and status='ACTIVE') then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED') then raise exception 'NOT_CONNECTED'; end if;
  select jsonb_build_object('settings',coalesce((select jsonb_build_object('enabled',auto_remove_salutations,'revision',revision,'authorizedAt',authorized_at) from public.style_learning_settings where user_id=p_user_id and gmail_account_id=p_account_id),'{"enabled":false,"revision":null,"authorizedAt":null}'::jsonb),
    'proposals',coalesce((select jsonb_agg(value order by created_at desc,id) from (
      select s.id,s.created_at,jsonb_build_object('id',s.id,'scope',jsonb_build_object('kind',p.scope_kind,'key',p.scope_key),'feature',s.feature,'category',s.category,'status',s.status,
        'baseRevision',s.base_revision,'appliedRevision',s.applied_revision,'baseVersion',s.base_version,'appliedVersion',s.applied_version,'currentRevision',p.revision,
        'support',s.support,'total',s.total,'threads',s.threads,'days',s.days,'audiences',s.audiences,'automatic',s.automatic,'createdAt',s.created_at,'decidedAt',s.decided_at,
        'before',coalesce(s.before_profile,p.profile)->case s.feature when 'greeting' then 'preferred_greetings' else 'preferred_closings' end,
        'after',public.style_learning_phrases(s.feature,s.category,coalesce(s.before_profile,p.profile)->>'language')) as value
      from public.style_learning_proposals s join public.style_profiles p on p.id=s.profile_id
      where s.user_id=p_user_id and s.gmail_account_id=p_account_id order by s.created_at desc,s.id limit 50
    ) recent),'[]'::jsonb)) into result;
  return result;
end;
$$;
create function public.revoke_style_learning_authorization() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='users' then
    if new.status<>'ACTIVE' then update public.style_learning_settings set auto_remove_salutations=false,authorized_at=null,revision=gen_random_uuid() where user_id=new.id; end if;
  elsif new.status<>'CONNECTED' then update public.style_learning_settings set auto_remove_salutations=false,authorized_at=null,revision=gen_random_uuid() where gmail_account_id=new.id; end if;
  return new;
end;
$$;
create trigger user_revoke_style_learning after update of status on public.users for each row execute function public.revoke_style_learning_authorization();
create trigger gmail_revoke_style_learning after update of status on public.gmail_accounts for each row execute function public.revoke_style_learning_authorization();
revoke all on function public.style_learning_phrases(text,text,text),public.style_learning_evidence(uuid,text,text),public.style_learning_evidence_valid(jsonb,boolean),public.style_learning_profile_current(public.style_profiles,public.style_profiles),
  public.decide_style_learning(uuid,uuid,uuid,uuid,text,boolean),public.refresh_style_learning(integer),public.set_style_learning_settings(uuid,uuid,boolean,uuid,text),public.get_style_learning(uuid,uuid),public.revoke_style_learning_authorization() from public,anon,authenticated;
grant execute on function public.style_learning_phrases(text,text,text),public.style_learning_evidence(uuid,text,text),public.style_learning_evidence_valid(jsonb,boolean),public.style_learning_profile_current(public.style_profiles,public.style_profiles),
  public.decide_style_learning(uuid,uuid,uuid,uuid,text,boolean),public.refresh_style_learning(integer),public.set_style_learning_settings(uuid,uuid,boolean,uuid,text),public.get_style_learning(uuid,uuid),public.revoke_style_learning_authorization() to service_role;
