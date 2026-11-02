alter table public.draft_generations add constraint draft_generations_feedback_owner_key unique(id,user_id,gmail_account_id);
create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_account_id uuid not null,
  draft_generation_id uuid not null unique,
  generation_run_id uuid,
  sent_message_id text not null check(char_length(sent_message_id) between 1 and 512 and sent_message_id ~ '^[A-Za-z0-9_-]+$'),
  sent_at timestamptz not null,
  algorithm_version text not null default 'mail058-v1' check(algorithm_version='mail058-v1'),
  status text not null default 'PENDING' check(status in ('PENDING','RETRY','COMPLETED','SKIPPED')),
  reason_code text check(reason_code in ('ORIGINAL_UNAVAILABLE','INVALID_MESSAGE','UNSUPPORTED_CONTENT','LIMIT_EXCEEDED','IDENTITY_CHANGED','RETRY_LIMIT','SENT_UNAVAILABLE')),
  metrics jsonb check(metrics is null or (octet_length(metrics::text)<=8192 and extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"version":{"type":"string","const":"mail058-v1"},"classification":{"type":"string","enum":["UNCHANGED","STYLE_ONLY","FACTUAL_REVIEW","CONTENT_REVIEW"]},"learningEligible":{"type":"boolean"},"significantChange":{"type":"boolean"},"originalCharacters":{"type":"integer","minimum":0,"maximum":32000},"sentCharacters":{"type":"integer","minimum":0,"maximum":32000},"originalWords":{"type":"integer","minimum":0,"maximum":32000},"sentWords":{"type":"integer","minimum":0,"maximum":32000},"originalTokens":{"type":"integer","minimum":0,"maximum":32000},"sentTokens":{"type":"integer","minimum":0,"maximum":32000},"insertedTokens":{"type":"integer","minimum":0,"maximum":32000},"deletedTokens":{"type":"integer","minimum":0,"maximum":32000},"substitutedTokens":{"type":"integer","minimum":0,"maximum":32000},"editDistance":{"type":"integer","minimum":0,"maximum":32000},"similarity":{"type":"number","minimum":0,"maximum":1},"editRatio":{"type":"number","minimum":0,"maximum":1},"effortRatio":{"type":"number","minimum":0,"maximum":2000},"lengthDelta":{"type":"integer","minimum":-32000,"maximum":32000},"vocabularyAdded":{"type":"integer","minimum":0,"maximum":32000},"vocabularyRemoved":{"type":"integer","minimum":0,"maximum":32000},"greetingChanged":{"type":"boolean"},"closingChanged":{"type":"boolean"},"originalGreeting":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"sentGreeting":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"originalClosing":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"sentClosing":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"formattingChanged":{"type":"boolean"},"punctuationChanged":{"type":"boolean"},"attachmentsChanged":{"type":"boolean"},"factualSignals":{"maxItems":8,"type":"array","items":{"type":"string","enum":["QUANTITIES","CALENDAR","CONTACTS","LINKS","NEGATION","COMMITMENTS","ENTITIES","ADDRESSEE"]}}},"required":["version","classification","learningEligible","significantChange","originalCharacters","sentCharacters","originalWords","sentWords","originalTokens","sentTokens","insertedTokens","deletedTokens","substitutedTokens","editDistance","similarity","editRatio","effortRatio","lengthDelta","vocabularyAdded","vocabularyRemoved","greetingChanged","closingChanged","originalGreeting","sentGreeting","originalClosing","sentClosing","formattingChanged","punctuationChanged","attachmentsChanged","factualSignals"],"additionalProperties":false}'::json,metrics))),
  attempts integer not null default 0 check(attempts between 0 and 6),
  created_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_id uuid,
  lease_expires_at timestamptz,
  foreign key(gmail_account_id,user_id) references public.gmail_accounts(id,user_id) on delete cascade,
  foreign key(draft_generation_id,user_id,gmail_account_id) references public.draft_generations(id,user_id,gmail_account_id) on delete cascade,
  foreign key(generation_run_id,user_id,gmail_account_id) references public.generation_runs(id,user_id,gmail_account_id) on delete cascade,
  check((lease_id is null)=(lease_expires_at is null)),
  check((status='COMPLETED' and metrics is not null and generation_run_id is not null and reason_code is null and processed_at is not null)
    or (status='SKIPPED' and metrics is null and reason_code is not null and processed_at is not null)
    or (status='PENDING' and metrics is null and reason_code is null and processed_at is null)
    or (status='RETRY' and metrics is null and reason_code='SENT_UNAVAILABLE' and processed_at is null)),
  check(metrics is null or (
    (metrics->>'editDistance')::integer=(metrics->>'insertedTokens')::integer+(metrics->>'deletedTokens')::integer+(metrics->>'substitutedTokens')::integer
    and (metrics->>'sentTokens')::integer=(metrics->>'originalTokens')::integer+(metrics->>'insertedTokens')::integer-(metrics->>'deletedTokens')::integer
    and (not (metrics->>'learningEligible')::boolean or (metrics->>'classification'='STYLE_ONLY' and metrics->'factualSignals'='[]'::jsonb and not (metrics->>'attachmentsChanged')::boolean))
    and (metrics->>'classification'<>'UNCHANGED' or ((metrics->>'editDistance')::integer=0 and not (metrics->>'learningEligible')::boolean))
  ))
);
create index feedback_events_owner_period_idx on public.feedback_events(user_id,created_at);
create index feedback_events_account_owner_idx on public.feedback_events(gmail_account_id,user_id);
create index feedback_events_draft_owner_idx on public.feedback_events(draft_generation_id,user_id,gmail_account_id);
create index feedback_events_run_owner_idx on public.feedback_events(generation_run_id,user_id,gmail_account_id);
create index feedback_events_pending_idx on public.feedback_events(next_attempt_at,id) where status in ('PENDING','RETRY');
alter table public.feedback_events enable row level security;
revoke all on public.feedback_events from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.feedback_events to service_role;
grant select(id,user_id,gmail_account_id,draft_generation_id,generation_run_id,sent_message_id,sent_at,algorithm_version,status,reason_code,metrics,created_at,processed_at)
  on public.feedback_events to authenticated;
create policy feedback_events_select_own on public.feedback_events for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.users u where u.id=(select auth.uid()) and u.status='ACTIVE')
  and exists(select 1 from public.gmail_accounts a where a.id=gmail_account_id and a.user_id=(select auth.uid()) and a.status='CONNECTED')
);
create view public.reply_comparison_daily with(security_invoker=true) as
select user_id,gmail_account_id,(coalesce(processed_at,created_at) at time zone 'UTC')::date as day,
  count(*) as total,
  count(*) filter(where status='COMPLETED') as compared,
  count(*) filter(where status='SKIPPED') as skipped,
  count(*) filter(where status in ('PENDING','RETRY')) as pending,
  count(*) filter(where metrics->>'classification'='UNCHANGED') as unchanged,
  count(*) filter(where metrics->>'classification'='STYLE_ONLY') as style_only,
  count(*) filter(where metrics->>'classification'='FACTUAL_REVIEW') as factual_review,
  count(*) filter(where metrics->>'classification'='CONTENT_REVIEW') as content_review,
  count(*) filter(where metrics->>'learningEligible'='true') as learning_eligible,
  avg((metrics->>'similarity')::numeric) filter(where status='COMPLETED') as average_similarity,
  avg((metrics->>'editRatio')::numeric) filter(where status='COMPLETED') as average_edit_ratio,
  avg((metrics->>'effortRatio')::numeric) filter(where status='COMPLETED') as average_effort_ratio
from public.feedback_events group by user_id,gmail_account_id,(coalesce(processed_at,created_at) at time zone 'UTC')::date;
revoke all on public.reply_comparison_daily from public,anon,authenticated,service_role;
grant select on public.reply_comparison_daily to authenticated,service_role;

create function public.guard_reply_feedback() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if (new.id,new.user_id,new.gmail_account_id,new.draft_generation_id,new.generation_run_id,new.sent_message_id,new.sent_at,new.algorithm_version,new.created_at)
      is distinct from (old.id,old.user_id,old.gmail_account_id,old.draft_generation_id,old.generation_run_id,old.sent_message_id,old.sent_at,old.algorithm_version,old.created_at) then raise exception 'IMMUTABLE_FEEDBACK_IDENTITY'; end if;
    if old.status in ('COMPLETED','SKIPPED') then raise exception 'IMMUTABLE_FEEDBACK_RESULT'; end if;
  end if;
  if not exists(select 1 from public.draft_generations d where d.id=new.draft_generation_id and d.user_id=new.user_id and d.gmail_account_id=new.gmail_account_id
    and d.generation_run_id is not distinct from new.generation_run_id and d.sent_outcome->>'status'='SENT'
    and d.sent_outcome->>'messageId'=new.sent_message_id and (d.sent_outcome->>'sentAt')::timestamptz=new.sent_at) then raise exception 'INVALID_FEEDBACK_REFERENCE'; end if;
  return new;
end;
$$;
create trigger reply_feedback_guard before insert or update on public.feedback_events for each row execute function public.guard_reply_feedback();

create function public.claim_reply_comparisons(p_limit integer default 20,p_lease_seconds integer default 120) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'INVALID_COMPARISON_CONFIGURATION'; end if;
  insert into public.feedback_events(user_id,gmail_account_id,draft_generation_id,generation_run_id,sent_message_id,sent_at)
  select d.user_id,d.gmail_account_id,d.id,d.generation_run_id,d.sent_outcome->>'messageId',(d.sent_outcome->>'sentAt')::timestamptz
  from public.draft_generations d join public.users u on u.id=d.user_id and u.status='ACTIVE'
    join public.gmail_accounts a on a.id=d.gmail_account_id and a.user_id=d.user_id and a.status='CONNECTED'
  where d.sent_outcome->>'status'='SENT' and not exists(select 1 from public.feedback_events f where f.draft_generation_id=d.id)
  order by d.sent_checked_at,d.id limit p_limit for update of d skip locked
  on conflict(draft_generation_id) do nothing;
  with chosen as (
    select f.id from public.feedback_events f join public.users u on u.id=f.user_id and u.status='ACTIVE'
      join public.gmail_accounts a on a.id=f.gmail_account_id and a.user_id=f.user_id and a.status='CONNECTED'
    where f.status in ('PENDING','RETRY') and f.next_attempt_at<=clock_timestamp() and (f.lease_id is null or f.lease_expires_at<=clock_timestamp())
    order by f.next_attempt_at,f.id limit p_limit for update of f skip locked
  ),claimed as (
    update public.feedback_events f set attempts=least(attempts+1,6),lease_id=gen_random_uuid(),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
    from chosen where f.id=chosen.id returning f.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'userId',f.user_id,'gmailAccountId',f.gmail_account_id,'draftGenerationId',f.draft_generation_id,
    'generationRunId',f.generation_run_id,'threadId',d.thread_id,'sentMessageId',f.sent_message_id,'sentAt',f.sent_at,'leaseId',f.lease_id,'attempts',f.attempts,
    'intent',d.delivery_intent,'envelopeHash',d.delivery_envelope_hash,'draftInternetMessageId',d.draft_internet_message_id)),'[]'::jsonb)
    into result from claimed f join public.draft_generations d on d.id=f.draft_generation_id;
  return result;
end;
$$;
create function public.load_reply_comparison_original(p_user_id uuid,p_account_id uuid,p_feedback_id uuid,p_lease_id uuid) returns text
language sql security invoker set search_path='' as $$
  select c.body_text from public.feedback_events f
    join public.users u on u.id=f.user_id and u.status='ACTIVE'
    join public.gmail_accounts a on a.id=f.gmail_account_id and a.user_id=f.user_id and a.status='CONNECTED'
    join public.generation_content_authorizations consent on consent.gmail_account_id=f.gmail_account_id and consent.user_id=f.user_id
    join public.generation_temporary_content c on c.generation_run_id=f.generation_run_id and c.user_id=f.user_id and c.gmail_account_id=f.gmail_account_id and c.expires_at>clock_timestamp()
  where f.id=p_feedback_id and f.user_id=p_user_id and f.gmail_account_id=p_account_id and f.lease_id=p_lease_id and f.lease_expires_at>clock_timestamp() and f.status in ('PENDING','RETRY');
$$;
create function public.finish_reply_comparison(p_user_id uuid,p_account_id uuid,p_feedback_id uuid,p_lease_id uuid,p_result jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare feedback public.feedback_events%rowtype; result jsonb:=p_result; state text; reason text;
begin
  if p_result is null or octet_length(p_result::text)>16384 or not extensions.jsonb_matches_schema('{"$schema":"http://json-schema.org/draft-07/schema#","oneOf":[{"type":"object","properties":{"status":{"type":"string","const":"COMPLETED"},"metrics":{"type":"object","properties":{"version":{"type":"string","const":"mail058-v1"},"classification":{"type":"string","enum":["UNCHANGED","STYLE_ONLY","FACTUAL_REVIEW","CONTENT_REVIEW"]},"learningEligible":{"type":"boolean"},"significantChange":{"type":"boolean"},"originalCharacters":{"type":"integer","minimum":0,"maximum":32000},"sentCharacters":{"type":"integer","minimum":0,"maximum":32000},"originalWords":{"type":"integer","minimum":0,"maximum":32000},"sentWords":{"type":"integer","minimum":0,"maximum":32000},"originalTokens":{"type":"integer","minimum":0,"maximum":32000},"sentTokens":{"type":"integer","minimum":0,"maximum":32000},"insertedTokens":{"type":"integer","minimum":0,"maximum":32000},"deletedTokens":{"type":"integer","minimum":0,"maximum":32000},"substitutedTokens":{"type":"integer","minimum":0,"maximum":32000},"editDistance":{"type":"integer","minimum":0,"maximum":32000},"similarity":{"type":"number","minimum":0,"maximum":1},"editRatio":{"type":"number","minimum":0,"maximum":1},"effortRatio":{"type":"number","minimum":0,"maximum":2000},"lengthDelta":{"type":"integer","minimum":-32000,"maximum":32000},"vocabularyAdded":{"type":"integer","minimum":0,"maximum":32000},"vocabularyRemoved":{"type":"integer","minimum":0,"maximum":32000},"greetingChanged":{"type":"boolean"},"closingChanged":{"type":"boolean"},"originalGreeting":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"sentGreeting":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"originalClosing":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"sentClosing":{"type":"string","enum":["NONE","SHORT","FORMAL","GRATITUDE","WARM"]},"formattingChanged":{"type":"boolean"},"punctuationChanged":{"type":"boolean"},"attachmentsChanged":{"type":"boolean"},"factualSignals":{"maxItems":8,"type":"array","items":{"type":"string","enum":["QUANTITIES","CALENDAR","CONTACTS","LINKS","NEGATION","COMMITMENTS","ENTITIES","ADDRESSEE"]}}},"required":["version","classification","learningEligible","significantChange","originalCharacters","sentCharacters","originalWords","sentWords","originalTokens","sentTokens","insertedTokens","deletedTokens","substitutedTokens","editDistance","similarity","editRatio","effortRatio","lengthDelta","vocabularyAdded","vocabularyRemoved","greetingChanged","closingChanged","originalGreeting","sentGreeting","originalClosing","sentClosing","formattingChanged","punctuationChanged","attachmentsChanged","factualSignals"],"additionalProperties":false}},"required":["status","metrics"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"SKIPPED"},"reason":{"type":"string","enum":["ORIGINAL_UNAVAILABLE","INVALID_MESSAGE","UNSUPPORTED_CONTENT","LIMIT_EXCEEDED","IDENTITY_CHANGED","RETRY_LIMIT"]}},"required":["status","reason"],"additionalProperties":false},{"type":"object","properties":{"status":{"type":"string","const":"RETRY"},"reason":{"type":"string","const":"SENT_UNAVAILABLE"}},"required":["status","reason"],"additionalProperties":false}]}'::json,p_result) then raise exception 'INVALID_COMPARISON_RESULT'; end if;
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for share;
  if not found then return false; end if;
  -- Shares the account lock with consent withdrawal, retention changes and disconnect.
  perform 1 from public.gmail_accounts where id=p_account_id and user_id=p_user_id and status='CONNECTED' for share;
  if not found then return false; end if;
  select * into feedback from public.feedback_events where id=p_feedback_id and user_id=p_user_id and gmail_account_id=p_account_id
    and lease_id=p_lease_id and lease_expires_at>clock_timestamp() and status in ('PENDING','RETRY') for update;
  if not found or feedback.lease_expires_at<=clock_timestamp() then return false; end if;
  if p_result->>'status'='COMPLETED' and public.load_reply_comparison_original(p_user_id,p_account_id,p_feedback_id,p_lease_id) is null then
    result:='{"status":"SKIPPED","reason":"ORIGINAL_UNAVAILABLE"}'::jsonb;
  end if;
  state:=result->>'status';reason:=result->>'reason';
  if state='RETRY' and feedback.attempts>=5 then state:='SKIPPED';reason:='RETRY_LIMIT'; end if;
  update public.feedback_events set status=state,reason_code=reason,metrics=case when state='COMPLETED' then result->'metrics' else null end,
    processed_at=case when state in ('COMPLETED','SKIPPED') then clock_timestamp() else null end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*greatest(1,feedback.attempts))),lease_id=null,lease_expires_at=null where id=feedback.id;
  -- The authorized original has served its comparison purpose and can be purged early.
  if state='COMPLETED' then delete from public.generation_temporary_content where generation_run_id=feedback.generation_run_id and user_id=p_user_id and gmail_account_id=p_account_id; end if;
  return true;
end;
$$;
create function public.clear_reply_feedback_on_identity_reset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.action='STYLE_DELETED' and new.user_id is not null then delete from public.feedback_events where user_id=new.user_id; end if;
  return new;
end;
$$;
create trigger account_identity_reply_feedback after insert on public.account_data_events for each row execute function public.clear_reply_feedback_on_identity_reset();
revoke all on function public.guard_reply_feedback(),public.claim_reply_comparisons(integer,integer),public.load_reply_comparison_original(uuid,uuid,uuid,uuid),
  public.finish_reply_comparison(uuid,uuid,uuid,uuid,jsonb),public.clear_reply_feedback_on_identity_reset() from public,anon,authenticated;
grant execute on function public.guard_reply_feedback(),public.claim_reply_comparisons(integer,integer),public.load_reply_comparison_original(uuid,uuid,uuid,uuid),
  public.finish_reply_comparison(uuid,uuid,uuid,uuid,jsonb),public.clear_reply_feedback_on_identity_reset() to service_role;
