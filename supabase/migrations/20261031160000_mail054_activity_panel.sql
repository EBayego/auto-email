alter table public.draft_generations add column warnings text[] not null default '{}'
  check(cardinality(warnings)<=16 and array_position(warnings,null) is null and warnings <@ array[
    'HUMAN_REVIEW_REQUIRED','MISSING_INFORMATION','UNSUPPORTED_FACT','UNSUPPORTED_COMMITMENT','UNVERIFIED_EVIDENCE','HIGH_RISK','PROMPT_INJECTION','NO_REPLY_REQUIRED','LANGUAGE_MISMATCH','UNANSWERED_QUESTION','STYLE_PREFERENCE_MISMATCH','STYLE_PROFILE_UNAVAILABLE','KNOWLEDGE_CONFLICT','KNOWLEDGE_NOT_CURRENT','KNOWLEDGE_INSUFFICIENT','POLICY_RESTRICTED']::text[]);
create index email_jobs_activity_idx on public.email_jobs(user_id,created_at desc,id desc);
create index email_jobs_activity_status_idx on public.email_jobs(user_id,status,created_at desc,id desc);
create index response_policy_events_activity_idx on public.response_policy_events(user_id,gmail_account_id,target_message_id,thread_id,created_at desc);
create index response_validation_events_activity_idx on public.response_validation_events(user_id,gmail_account_id,target_message_id,thread_id,created_at desc);

create function public.activity_job_summary(p_user_id uuid,p_job_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p_job public.email_jobs%rowtype;
begin
  select * into p_job from public.email_jobs where id=p_job_id and user_id=p_user_id;
  if not found then return null; end if;
  return (select jsonb_build_object('id',(p_job).id,'threadId',(p_job).thread_id,'status',(p_job).status,
    'reason',(p_job).reason_code,'category',(p_job).classification->>'intent',
    'classificationReasons',coalesce((p_job).classification->'reasons','[]'::jsonb),'risks',coalesce((p_job).classification->'riskFlags','[]'::jsonb),
    'attempts',(p_job).attempt_count,'createdAt',(p_job).created_at,'updatedAt',(p_job).updated_at,
    'startedAt',(p_job).started_at,'finishedAt',(p_job).finished_at,'draftId',(p_job).draft_id,
    'draft',(select jsonb_build_object('status',d.status,'draftId',d.draft_id,'verifiedAt',d.verified_at,'reconciliation',d.reconciliation_result,
      'createdAt',d.created_at,'updatedAt',d.updated_at,'warnings',d.warnings)
      from public.draft_generations d where d.user_id=(p_job).user_id and d.gmail_account_id=(p_job).gmail_account_id
        and d.thread_id=(p_job).thread_id and d.target_message_id=(p_job).target_message_id)));
end;
$$;
create function public.get_activity_feed(p_user_id uuid,p_status text default 'ALL',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_status is null or p_status not in ('ALL','PENDING','CLASSIFYING','GENERATING','DRAFT_CREATED','SKIPPED','REVIEW_REQUIRED','FAILED')
    or (p_before is null)<>(p_before_id is null) or p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_INPUT'; end if;
  if not exists(select 1 from public.users where id=p_user_id and status='ACTIVE') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'overview',(select jsonb_build_object('accountEmail',a.email,'accountStatus',a.status,'automationEnabled',s.automation_enabled,
      'pollSeconds',s.poll_interval_seconds,'dailyLimit',s.max_daily_drafts,'lastSyncAt',a.last_sync_at,'manualUntil',a.manual_processing_until,
      'manualActive',coalesce(a.status='CONNECTED' and a.manual_processing_until>statement_timestamp(),false))
      from public.user_settings s left join public.gmail_accounts a on a.user_id=s.user_id where s.user_id=p_user_id),
    'counts',(select jsonb_object_agg(status,amount) from (select k.status,count(j.id) amount from
      unnest(array['PENDING','CLASSIFYING','GENERATING','DRAFT_CREATED','SKIPPED','REVIEW_REQUIRED','FAILED']) k(status)
      left join public.email_jobs j on j.user_id=p_user_id and j.status=k.status group by k.status) counts),
    'runs',coalesce((select jsonb_agg(value order by started_at desc,id desc) from (
      select r.id,r.started_at,jsonb_build_object('id',r.id,'trigger',r.trigger_kind,'status',r.status,'startedAt',r.started_at,'finishedAt',r.finished_at,
        'detected',r.messages_detected,'processed',r.messages_processed,'drafts',r.drafts_created,'errors',r.error_count,'error',r.error_code) value
      from public.processing_runs r where r.user_id=p_user_id order by r.started_at desc,r.id desc limit 20) recent),'[]'::jsonb),
    'jobs',coalesce((select jsonb_agg(public.activity_job_summary(p_user_id,j.id) order by j.created_at desc,j.id desc) from (
      select * from public.email_jobs where user_id=p_user_id and (p_status='ALL' or status=p_status)
        and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit p_limit+1) j),'[]'::jsonb));
end;
$$;
create function public.get_activity_detail(p_user_id uuid,p_job_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare job public.email_jobs%rowtype; draft public.draft_generations%rowtype;
begin
  if not exists(select 1 from public.users where id=p_user_id and status='ACTIVE') then raise exception 'FORBIDDEN'; end if;
  select * into job from public.email_jobs where id=p_job_id and user_id=p_user_id;
  if not found then return null; end if;
  select * into draft from public.draft_generations where user_id=p_user_id and gmail_account_id=job.gmail_account_id and thread_id=job.thread_id and target_message_id=job.target_message_id;
  return jsonb_build_object('job',public.activity_job_summary(p_user_id,job.id),
    'events',coalesce((select jsonb_agg(value order by id) from (select id,jsonb_build_object('at',occurred_at,'from',from_status,'to',to_status,'reason',reason_code) value
      from public.email_job_events where user_id=p_user_id and gmail_account_id=job.gmail_account_id and email_job_id=job.id order by id desc limit 100) events),'[]'::jsonb),
    'eventsTruncated',(select count(*)>100 from (select 1 from public.email_job_events where user_id=p_user_id and gmail_account_id=job.gmail_account_id and email_job_id=job.id limit 101) events),
    'policies',coalesce((select jsonb_agg(value order by created_at,id) from (
      select id,created_at,jsonb_build_object('at',created_at,'phase',phase,'action',action,'reasons',reasons) value from public.response_policy_events
      where user_id=p_user_id and gmail_account_id=job.gmail_account_id and thread_id=job.thread_id and target_message_id=job.target_message_id order by created_at desc,id desc limit 50) policies),'[]'::jsonb),
    'policiesTruncated',(select count(*)>50 from (select 1 from public.response_policy_events where user_id=p_user_id and gmail_account_id=job.gmail_account_id and thread_id=job.thread_id and target_message_id=job.target_message_id limit 51) policies),
    'validations',coalesce((select jsonb_agg(value order by created_at,id) from (
      select id,created_at,jsonb_build_object('at',created_at,'status',validation->>'status','claims',validation->'claimCount',
        'issues',coalesce((select jsonb_agg(jsonb_build_object('kind',issue->>'kind','reason',issue->>'reason')) from jsonb_array_elements(validation->'issues') issue),'[]'::jsonb)) value
      from public.response_validation_events where user_id=p_user_id and gmail_account_id=job.gmail_account_id and thread_id=job.thread_id and target_message_id=job.target_message_id order by created_at desc,id desc limit 20) validations),'[]'::jsonb),
    'validationsTruncated',(select count(*)>20 from (select 1 from public.response_validation_events where user_id=p_user_id and gmail_account_id=job.gmail_account_id and thread_id=job.thread_id and target_message_id=job.target_message_id limit 21) validations),
    'sources',coalesce((select jsonb_agg(case ref->>'kind'
      when 'KNOWLEDGE_FRAGMENT' then jsonb_build_object('kind','KNOWLEDGE_FRAGMENT','sourceTitle',s.title,'documentName',d.name,'version',(ref->>'version')::integer,'currentVersion',d.version,
        'available',coalesce(s.enabled and d.status='READY' and d.source_id=s.id and d.version=(ref->>'version')::integer,false))
      else jsonb_build_object('kind',ref->>'kind') end order by position)
      from jsonb_array_elements(coalesce(draft.sources_used,'[]'::jsonb)) with ordinality refs(ref,position)
      left join public.knowledge_sources s on s.id=(ref->>'sourceId')::uuid and s.user_id=p_user_id
      left join public.source_documents d on d.id=(ref->>'documentId')::uuid and d.user_id=p_user_id),'[]'::jsonb));
end;
$$;
revoke all on function public.activity_job_summary(uuid,uuid),public.get_activity_feed(uuid,text,timestamptz,uuid,integer),public.get_activity_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.activity_job_summary(uuid,uuid),public.get_activity_feed(uuid,text,timestamptz,uuid,integer),public.get_activity_detail(uuid,uuid) to service_role;
