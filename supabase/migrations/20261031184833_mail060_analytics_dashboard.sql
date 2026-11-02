create index draft_generations_analytics_period_idx on public.draft_generations(user_id,created_at);
create function public.analytics_period_totals(p_user_id uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
  with generations as (
    select count(*) as attempts,count(*) filter(where status='FAILED') as failures,
      count(*) filter(where input_tokens is not null and output_tokens is not null) as known_usage,
      coalesce(sum(input_tokens),0) as input_tokens,coalesce(sum(output_tokens),0) as output_tokens,coalesce(sum(model_calls),0) as model_calls,
      count(*) filter(where estimated_cost_usd is not null) as priced,sum(estimated_cost_usd) as cost,avg(estimated_cost_usd) as mean_cost,avg(duration_ms) as mean_duration
    from public.generation_runs where user_id=p_user_id and created_at>=p_from and created_at<p_to
  ),drafts as (
    select d.*,f.status as feedback_status,f.metrics
    from public.draft_generations d left join public.feedback_events f on f.draft_generation_id=d.id and f.user_id=d.user_id and f.gmail_account_id=d.gmail_account_id
    where d.user_id=p_user_id and d.created_at>=p_from and d.created_at<p_to
  ),delivery as (
    select count(*) as attempts,
      count(*) filter(where draft_id is not null or sent_outcome->>'status'='SENT') as created,
      count(*) filter(where sent_outcome->>'status'='SENT') as sent,
      count(*) filter(where sent_outcome->>'status'='MANUAL_REPLY') as manual,
      count(*) filter(where status='CANCELLED' or sent_outcome->>'status'='DISCARDED') as discarded,
      count(*) filter(where sent_outcome->>'status'='INDETERMINATE') as indeterminate,
      count(*) filter(where sent_outcome->>'status'='PENDING' and status<>'CANCELLED') as pending,
      count(*) filter(where feedback_status='COMPLETED') as compared,
      count(*) filter(where feedback_status='COMPLETED' and metrics->>'classification'<>'UNCHANGED') as edited,
      count(*) filter(where feedback_status='COMPLETED' and metrics->>'classification'='UNCHANGED') as unchanged,
      count(*) filter(where feedback_status='COMPLETED' and metrics->>'classification'='FACTUAL_REVIEW') as factual,
      count(*) filter(where feedback_status='COMPLETED' and metrics->>'classification'='CONTENT_REVIEW') as content,
      count(*) filter(where feedback_status='SKIPPED') as comparison_skipped,
      count(*) filter(where sent_outcome->>'status'='SENT' and (feedback_status is null or feedback_status in ('PENDING','RETRY'))) as comparison_pending,
      coalesce(sum((metrics->>'editDistance')::bigint) filter(where feedback_status='COMPLETED'),0) as edit_distance,
      avg((metrics->>'similarity')::numeric) filter(where feedback_status='COMPLETED') as mean_similarity
    from drafts
  ),jobs as (
    select count(*) as total,count(*) filter(where status='SKIPPED') as skipped,count(*) filter(where status='REVIEW_REQUIRED') as review,count(*) filter(where status='FAILED') as failed,
      coalesce(sum((classification->>'inputTokens')::bigint),0) as input_tokens,coalesce(sum((classification->>'outputTokens')::bigint),0) as output_tokens
    from public.email_jobs where user_id=p_user_id and created_at>=p_from and created_at<p_to
  ) select jsonb_build_object(
    'generationAttempts',g.attempts,'generationFailures',g.failures,'usageKnownGenerations',g.known_usage,'usageUnknownGenerations',g.attempts-g.known_usage,
    'inputTokens',g.input_tokens,'outputTokens',g.output_tokens,'modelCalls',g.model_calls,'pricedGenerations',g.priced,'unpricedGenerations',g.attempts-g.priced,
    'knownCostUsd',g.cost,'meanKnownCostUsd',g.mean_cost,'meanDurationMs',g.mean_duration,
    'draftAttempts',d.attempts,'draftsCreated',d.created,'sendsConfirmed',d.sent,'independentReplies',d.manual,'discardedBeforeWrite',d.discarded,'indeterminate',d.indeterminate,'pending',d.pending,
    'compared',d.compared,'edited',d.edited,'unchanged',d.unchanged,'factualReview',d.factual,'contentReview',d.content,'comparisonSkipped',d.comparison_skipped,'comparisonPending',d.comparison_pending,
    'totalEditDistance',d.edit_distance,'meanSimilarity',d.mean_similarity,
    'jobTotal',j.total,'skippedJobs',j.skipped,'reviewJobs',j.review,'failedJobs',j.failed,'classificationInputTokens',j.input_tokens,'classificationOutputTokens',j.output_tokens
  ) from generations g cross join delivery d cross join jobs j;
$$;
create function public.analytics_reason_counts(p_user_id uuid,p_from timestamptz,p_to timestamptz,p_status text) returns jsonb
language sql stable security invoker set search_path='' as $$
  with reasons as (
    select case when reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$' then reason_code else 'UNSPECIFIED' end as code,count(*) as amount
    from public.email_jobs where user_id=p_user_id and created_at>=p_from and created_at<p_to and status=p_status
    group by 1
  ),ranked as (select code,amount,row_number() over(order by amount desc,code) as position from reasons)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('code',code,'count',amount) order by position) filter(where position<=10),'[]'::jsonb),
    'other',coalesce(sum(amount) filter(where position>10),0)) from ranked;
$$;
create function public.get_analytics_dashboard(p_user_id uuid,p_days integer default 30,p_as_of timestamptz default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=coalesce(p_as_of,statement_timestamp());current_start timestamptz;previous_start timestamptz;local_day date;daily jsonb;omissions jsonb;reviews jsonb;
begin
  if p_days is null or p_days not in (7,30,90) or stamp<'2000-01-01'::timestamptz or stamp>clock_timestamp()+interval '1 minute' then raise exception 'INVALID_INPUT'; end if;
  if not exists(select 1 from public.users where id=p_user_id and status='ACTIVE') then raise exception 'FORBIDDEN'; end if;
  local_day:=(stamp at time zone 'Europe/Madrid')::date;
  current_start:=(local_day-(p_days-1))::timestamp at time zone 'Europe/Madrid';
  previous_start:=current_start-(stamp-current_start);
  select jsonb_agg(jsonb_build_object('day',day::date,'generationAttempts',totals->'generationAttempts','draftsCreated',totals->'draftsCreated',
    'sendsConfirmed',totals->'sendsConfirmed','compared',totals->'compared','edited',totals->'edited','knownCostUsd',totals->'knownCostUsd') order by day) into daily
  from generate_series(0,p_days-1) offset_day
  cross join lateral (select local_day-(p_days-1)+offset_day as day) dates
  cross join lateral (select public.analytics_period_totals(p_user_id,day::date::timestamp at time zone 'Europe/Madrid',least((day::date+1)::timestamp at time zone 'Europe/Madrid',stamp)) as totals) values_for_day;
  omissions:=public.analytics_reason_counts(p_user_id,current_start,stamp,'SKIPPED');
  reviews:=public.analytics_reason_counts(p_user_id,current_start,stamp,'REVIEW_REQUIRED');
  return jsonb_build_object('version','mail060-v1','timezone','Europe/Madrid','observedAt',stamp,'days',p_days,
    'current',jsonb_build_object('from',current_start,'to',stamp,'totals',public.analytics_period_totals(p_user_id,current_start,stamp)),
    'previous',jsonb_build_object('from',previous_start,'to',current_start,'totals',public.analytics_period_totals(p_user_id,previous_start,current_start)),
    'daily',coalesce(daily,'[]'::jsonb),'omissionReasons',omissions->'items','omissionOther',omissions->'other','reviewReasons',reviews->'items','reviewOther',reviews->'other');
end;
$$;
revoke all on function public.analytics_period_totals(uuid,timestamptz,timestamptz),public.analytics_reason_counts(uuid,timestamptz,timestamptz,text),public.get_analytics_dashboard(uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.analytics_period_totals(uuid,timestamptz,timestamptz),public.analytics_reason_counts(uuid,timestamptz,timestamptz,text),public.get_analytics_dashboard(uuid,integer,timestamptz) to service_role;
