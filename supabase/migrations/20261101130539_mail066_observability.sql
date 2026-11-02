begin;


  create table "public"."operational_alerts" (
    "id" uuid not null default gen_random_uuid(),
    "kind" text not null,
    "stage" text not null,
    "severity" text not null,
    "state" text not null default 'OPEN'::text,
    "affected_count" bigint not null,
    "run_id" uuid,
    "first_seen_at" timestamp with time zone not null default clock_timestamp(),
    "last_seen_at" timestamp with time zone not null default clock_timestamp(),
    "resolved_at" timestamp with time zone,
    "next_delivery_at" timestamp with time zone not null default clock_timestamp(),
    "delivery_lease" uuid,
    "delivery_lease_until" timestamp with time zone,
    "delivery_attempts" integer not null default 0,
    "delivered_at" timestamp with time zone
      );


alter table "public"."operational_alerts" enable row level security;


  create table "public"."operational_monitor_state" (
    "singleton" boolean not null default true,
    "installed_at" timestamp with time zone not null default clock_timestamp(),
    "checked_at" timestamp with time zone
      );


alter table "public"."operational_monitor_state" enable row level security;


  create table "public"."operational_runs" (
    "id" uuid not null,
    "stage" text not null,
    "status" text not null default 'RUNNING'::text,
    "started_at" timestamp with time zone not null default clock_timestamp(),
    "heartbeat_at" timestamp with time zone not null default clock_timestamp(),
    "finished_at" timestamp with time zone,
    "duration_ms" integer
      );


alter table "public"."operational_runs" enable row level security;


  create table "public"."operational_spans" (
    "id" uuid not null,
    "run_id" uuid not null,
    "stage" text not null,
    "outcome" text not null,
    "reason_code" text,
    "duration_ms" integer not null,
    "input_tokens" bigint,
    "output_tokens" bigint,
    "estimated_cost_usd" numeric(24,8),
    "created_at" timestamp with time zone not null default clock_timestamp()
      );


alter table "public"."operational_spans" enable row level security;

CREATE INDEX operational_alerts_delivery_idx ON public.operational_alerts USING btree (next_delivery_at) WHERE (state = 'OPEN'::text);

CREATE UNIQUE INDEX operational_alerts_kind_stage_key ON public.operational_alerts USING btree (kind, stage);

CREATE UNIQUE INDEX operational_alerts_pkey ON public.operational_alerts USING btree (id);

CREATE INDEX operational_alerts_run_idx ON public.operational_alerts USING btree (run_id);

CREATE UNIQUE INDEX operational_monitor_state_pkey ON public.operational_monitor_state USING btree (singleton);

CREATE UNIQUE INDEX operational_runs_pkey ON public.operational_runs USING btree (id);

CREATE INDEX operational_runs_retention_idx ON public.operational_runs USING btree (started_at);

CREATE INDEX operational_runs_stage_time_idx ON public.operational_runs USING btree (stage, started_at DESC);

CREATE UNIQUE INDEX operational_spans_pkey ON public.operational_spans USING btree (id);

CREATE INDEX operational_spans_run_idx ON public.operational_spans USING btree (run_id);

CREATE INDEX operational_spans_time_stage_idx ON public.operational_spans USING btree (created_at, stage);

alter table "public"."operational_alerts" add constraint "operational_alerts_pkey" PRIMARY KEY using index "operational_alerts_pkey";

alter table "public"."operational_monitor_state" add constraint "operational_monitor_state_pkey" PRIMARY KEY using index "operational_monitor_state_pkey";

alter table "public"."operational_runs" add constraint "operational_runs_pkey" PRIMARY KEY using index "operational_runs_pkey";

alter table "public"."operational_spans" add constraint "operational_spans_pkey" PRIMARY KEY using index "operational_spans_pkey";

alter table "public"."operational_alerts" add constraint "operational_alerts_affected_count_check" CHECK ((affected_count >= 0)) not valid;

alter table "public"."operational_alerts" validate constraint "operational_alerts_affected_count_check";

alter table "public"."operational_alerts" add constraint "operational_alerts_kind_check" CHECK ((kind = ANY (ARRAY['IMPORTANT_FAILURE'::text, 'REPEATED_ERRORS'::text, 'WORKER_FAILURE_RATE'::text, 'WORKER_STALLED'::text, 'SYNC_STALE'::text, 'JOB_STALLED'::text]))) not valid;

alter table "public"."operational_alerts" validate constraint "operational_alerts_kind_check";

alter table "public"."operational_alerts" add constraint "operational_alerts_kind_stage_key" UNIQUE using index "operational_alerts_kind_stage_key";

alter table "public"."operational_alerts" add constraint "operational_alerts_run_id_fkey" FOREIGN KEY (run_id) REFERENCES public.operational_runs(id) ON DELETE SET NULL not valid;

alter table "public"."operational_alerts" validate constraint "operational_alerts_run_id_fkey";

alter table "public"."operational_alerts" add constraint "operational_alerts_severity_check" CHECK ((severity = ANY (ARRAY['warning'::text, 'critical'::text]))) not valid;

alter table "public"."operational_alerts" validate constraint "operational_alerts_severity_check";

alter table "public"."operational_alerts" add constraint "operational_alerts_stage_check" CHECK ((stage = ANY (ARRAY['WORKER'::text, 'SYNC'::text, 'JOBS'::text, 'ONBOARDING'::text, 'DELETION'::text, 'GMAIL'::text, 'OPENAI'::text, 'KNOWLEDGE'::text, 'WEB'::text, 'MONITOR'::text]))) not valid;

alter table "public"."operational_alerts" validate constraint "operational_alerts_stage_check";

alter table "public"."operational_alerts" add constraint "operational_alerts_state_check" CHECK ((state = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text]))) not valid;

alter table "public"."operational_alerts" validate constraint "operational_alerts_state_check";

alter table "public"."operational_monitor_state" add constraint "operational_monitor_state_singleton_check" CHECK (singleton) not valid;

alter table "public"."operational_monitor_state" validate constraint "operational_monitor_state_singleton_check";

alter table "public"."operational_runs" add constraint "operational_runs_check" CHECK (((status = 'RUNNING'::text) = (finished_at IS NULL))) not valid;

alter table "public"."operational_runs" validate constraint "operational_runs_check";

alter table "public"."operational_runs" add constraint "operational_runs_duration_ms_check" CHECK ((duration_ms >= 0)) not valid;

alter table "public"."operational_runs" validate constraint "operational_runs_duration_ms_check";

alter table "public"."operational_runs" add constraint "operational_runs_stage_check" CHECK ((stage = ANY (ARRAY['WORKER'::text, 'SYNC'::text, 'JOBS'::text, 'ONBOARDING'::text, 'DELETION'::text, 'GMAIL'::text, 'OPENAI'::text, 'KNOWLEDGE'::text, 'WEB'::text, 'MONITOR'::text]))) not valid;

alter table "public"."operational_runs" validate constraint "operational_runs_stage_check";

alter table "public"."operational_runs" add constraint "operational_runs_status_check" CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text]))) not valid;

alter table "public"."operational_runs" validate constraint "operational_runs_status_check";

alter table "public"."operational_spans" add constraint "operational_spans_duration_ms_check" CHECK ((duration_ms >= 0)) not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_duration_ms_check";

alter table "public"."operational_spans" add constraint "operational_spans_estimated_cost_usd_check" CHECK ((estimated_cost_usd >= (0)::numeric)) not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_estimated_cost_usd_check";

alter table "public"."operational_spans" add constraint "operational_spans_input_tokens_check" CHECK (((input_tokens >= 0) AND (input_tokens <= '1000000000000'::bigint))) not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_input_tokens_check";

alter table "public"."operational_spans" add constraint "operational_spans_outcome_check" CHECK ((outcome = ANY (ARRAY['SUCCEEDED'::text, 'FAILED'::text]))) not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_outcome_check";

alter table "public"."operational_spans" add constraint "operational_spans_output_tokens_check" CHECK (((output_tokens >= 0) AND (output_tokens <= '1000000000000'::bigint))) not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_output_tokens_check";

alter table "public"."operational_spans" add constraint "operational_spans_reason_code_check" CHECK ((reason_code ~ '^[A-Z][A-Z0-9_]{0,79}$'::text)) not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_reason_code_check";

alter table "public"."operational_spans" add constraint "operational_spans_run_id_fkey" FOREIGN KEY (run_id) REFERENCES public.operational_runs(id) ON DELETE CASCADE not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_run_id_fkey";

alter table "public"."operational_spans" add constraint "operational_spans_stage_check" CHECK ((stage = ANY (ARRAY['WORKER'::text, 'SYNC'::text, 'JOBS'::text, 'ONBOARDING'::text, 'DELETION'::text, 'GMAIL'::text, 'OPENAI'::text, 'KNOWLEDGE'::text, 'WEB'::text, 'MONITOR'::text]))) not valid;

alter table "public"."operational_spans" validate constraint "operational_spans_stage_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_operational_health(p_window_seconds integer DEFAULT 900, p_stale_seconds integer DEFAULT 900, p_repeated_errors integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cutoff timestamptz; stale_count bigint; stalled_count bigint; failures bigint; total bigint; worker_age numeric; metrics jsonb; active_keys text[]:=array[]::text[]; item record;
begin
  if p_window_seconds is null or p_stale_seconds is null or p_repeated_errors is null or p_window_seconds not between 60 and 86400 or p_stale_seconds not between 120 and 86400 or p_repeated_errors not between 2 and 1000 then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.operational_monitor_state where singleton for update;
  cutoff:=clock_timestamp()-make_interval(secs=>p_window_seconds);
  select count(*),count(*) filter(where status='FAILED') into total,failures from public.operational_runs where stage='WORKER' and status<>'RUNNING' and started_at>=cutoff;
  select extract(epoch from clock_timestamp()-coalesce((select max(heartbeat_at) from public.operational_runs where stage='WORKER'),installed_at)) into worker_age from public.operational_monitor_state where singleton;
  if worker_age>p_stale_seconds then
    perform public.raise_operational_alert('WORKER_STALLED','WORKER',1); active_keys:=array_append(active_keys,'WORKER_STALLED:WORKER');
  end if;
  if total>=5 and failures::numeric/total>=0.2 then
    perform public.raise_operational_alert('WORKER_FAILURE_RATE','WORKER',failures); active_keys:=array_append(active_keys,'WORKER_FAILURE_RATE:WORKER');
  end if;
  select count(*) into stale_count from public.gmail_accounts a join public.users u on u.id=a.user_id and u.status='ACTIVE'
    join public.user_settings s on s.user_id=a.user_id and s.automation_enabled
    where a.status='CONNECTED' and public.privacy_authorization_valid(a.user_id)
      and greatest(coalesce(a.last_sync_at,a.created_at),s.updated_at)<clock_timestamp()-make_interval(secs=>greatest(p_stale_seconds,3*s.poll_interval_seconds));
  if stale_count>0 then perform public.raise_operational_alert('SYNC_STALE','SYNC',stale_count); active_keys:=array_append(active_keys,'SYNC_STALE:SYNC'); end if;
  select count(*) into stalled_count from public.email_jobs j join public.users u on u.id=j.user_id and u.status='ACTIVE'
    join public.gmail_accounts a on a.id=j.gmail_account_id and a.user_id=j.user_id and a.status='CONNECTED'
    where j.status in ('CLASSIFYING','GENERATING') and j.lease_expires_at<clock_timestamp()-interval '5 minutes';
  if stalled_count>0 then perform public.raise_operational_alert('JOB_STALLED','JOBS',stalled_count); active_keys:=array_append(active_keys,'JOB_STALLED:JOBS'); end if;
  for item in select stage,count(*) as failures from public.operational_spans where created_at>=cutoff and outcome='FAILED' group by stage having count(*)>=p_repeated_errors loop
    perform public.raise_operational_alert('REPEATED_ERRORS',item.stage,item.failures); active_keys:=array_append(active_keys,'REPEATED_ERRORS:'||item.stage);
  end loop;
  update public.operational_alerts set state='RESOLVED',resolved_at=clock_timestamp(),delivery_lease=null,delivery_lease_until=null
    where state='OPEN' and kind<>'IMPORTANT_FAILURE' and not(kind||':'||stage=any(active_keys));
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into metrics from (
    select stage,count(*) as calls,count(*) filter(where outcome='FAILED') as failures,
      round(avg(duration_ms),2) as mean_ms,percentile_disc(0.95) within group(order by duration_ms) as p95_ms,
      count(*) filter(where input_tokens is not null and output_tokens is not null) as usage_known_calls,
      sum(input_tokens) as input_tokens,sum(output_tokens) as output_tokens,
      count(*) filter(where estimated_cost_usd is not null) as priced_calls,sum(estimated_cost_usd) as estimated_cost_usd
    from public.operational_spans where created_at>=cutoff group by stage order by stage
  ) t;
  update public.operational_monitor_state set checked_at=clock_timestamp() where singleton;
  return jsonb_build_object('workerRuns',total,'workerFailures',failures,'workerFailureRate',case when total=0 then null else failures::numeric/total end,'workerAgeSeconds',greatest(0,round(worker_age)), 'staleSyncAccounts',stale_count,'stalledJobs',stalled_count,'stages',metrics);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_operational_alerts(p_limit integer DEFAULT 20)
 RETURNS SETOF public.operational_alerts
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
  return query with candidates as (
    select id from public.operational_alerts where state='OPEN' and next_delivery_at<=clock_timestamp()
      and (delivery_lease_until is null or delivery_lease_until<clock_timestamp())
    order by next_delivery_at,id limit p_limit for update skip locked
  ) update public.operational_alerts a set delivery_lease=gen_random_uuid(),delivery_lease_until=clock_timestamp()+interval '2 minutes',delivery_attempts=delivery_attempts+1
    from candidates c where a.id=c.id returning a.*;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_operational_alert_delivery(p_id uuid, p_lease uuid, p_success boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_success is null then raise exception 'INVALID_INPUT'; end if;
  update public.operational_alerts set delivery_lease=null,delivery_lease_until=null,
    delivered_at=case when p_success then clock_timestamp() else delivered_at end,
    next_delivery_at=clock_timestamp()+case when p_success then interval '30 minutes' else interval '5 minutes' end
    where id=p_id and delivery_lease=p_lease and delivery_lease_until>clock_timestamp() and state='OPEN';
  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_operational_run(p_id uuid, p_failed boolean, p_duration_ms integer, p_spans jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_run public.operational_runs%rowtype;
begin
  if p_failed is null or p_duration_ms is null or p_duration_ms<0 or jsonb_typeof(p_spans) is distinct from 'array' or jsonb_array_length(p_spans)>1000 then raise exception 'INVALID_INPUT'; end if;
  select * into current_run from public.operational_runs where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if current_run.status<>'RUNNING' then return false; end if;
  if exists(select 1 from jsonb_array_elements(p_spans) s where jsonb_typeof(s)<>'object' or (s->>'run_id')::uuid is distinct from p_id or
    (s-array['id','run_id','stage','outcome','reason_code','duration_ms','input_tokens','output_tokens','estimated_cost_usd'])<>'{}'::jsonb) then raise exception 'INVALID_INPUT'; end if;
  insert into public.operational_spans(id,run_id,stage,outcome,reason_code,duration_ms,input_tokens,output_tokens,estimated_cost_usd)
    select id,run_id,stage,outcome,reason_code,duration_ms,input_tokens,output_tokens,estimated_cost_usd
    from jsonb_to_recordset(p_spans) s(id uuid,run_id uuid,stage text,outcome text,reason_code text,duration_ms integer,input_tokens bigint,output_tokens bigint,estimated_cost_usd numeric);
  update public.operational_runs set status=case when p_failed then 'FAILED' else 'SUCCEEDED' end,finished_at=clock_timestamp(),heartbeat_at=clock_timestamp(),duration_ms=p_duration_ms where id=p_id;
  if p_failed then perform public.raise_operational_alert('IMPORTANT_FAILURE',current_run.stage,1,p_id);
  else update public.operational_alerts set state='RESOLVED',resolved_at=clock_timestamp(),delivery_lease=null,delivery_lease_until=null where kind='IMPORTANT_FAILURE' and stage=current_run.stage and state='OPEN'; end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_operational_telemetry(p_days integer DEFAULT 14)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_days is null or p_days not between 7 and 90 then raise exception 'INVALID_INPUT'; end if;
  delete from public.operational_runs where started_at<clock_timestamp()-make_interval(days=>p_days);
  delete from public.operational_alerts where state='RESOLVED' and resolved_at<clock_timestamp()-interval '90 days';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.raise_operational_alert(p_kind text, p_stage text, p_count bigint, p_run_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_count is null or p_count<1 then raise exception 'INVALID_INPUT'; end if;
  insert into public.operational_alerts(kind,stage,severity,affected_count,run_id)
    values(p_kind,p_stage,case when p_kind in ('IMPORTANT_FAILURE','WORKER_STALLED','JOB_STALLED') then 'critical' else 'warning' end,p_count,p_run_id)
  on conflict(kind,stage) do update set
    affected_count=excluded.affected_count,run_id=excluded.run_id,state='OPEN',resolved_at=null,
    first_seen_at=case when operational_alerts.state='RESOLVED' then clock_timestamp() else operational_alerts.first_seen_at end,
    next_delivery_at=case when operational_alerts.state='RESOLVED' then clock_timestamp() else operational_alerts.next_delivery_at end,
    last_seen_at=clock_timestamp();
end;
$function$
;

grant delete on table "public"."operational_alerts" to "service_role";

grant insert on table "public"."operational_alerts" to "service_role";

grant select on table "public"."operational_alerts" to "service_role";

grant update on table "public"."operational_alerts" to "service_role";

grant select on table "public"."operational_monitor_state" to "service_role";

grant update on table "public"."operational_monitor_state" to "service_role";

grant delete on table "public"."operational_runs" to "service_role";

grant insert on table "public"."operational_runs" to "service_role";

grant select on table "public"."operational_runs" to "service_role";

grant update on table "public"."operational_runs" to "service_role";

grant delete on table "public"."operational_spans" to "service_role";

grant insert on table "public"."operational_spans" to "service_role";

grant select on table "public"."operational_spans" to "service_role";

grant update on table "public"."operational_spans" to "service_role";

insert into public.operational_monitor_state(singleton) values(true) on conflict(singleton) do nothing;

revoke all on public.operational_runs,public.operational_spans,public.operational_alerts,public.operational_monitor_state from public,anon,authenticated;
revoke all on function public.raise_operational_alert(text,text,bigint,uuid),public.finish_operational_run(uuid,boolean,integer,jsonb),public.check_operational_health(integer,integer,integer),public.claim_operational_alerts(integer),public.finish_operational_alert_delivery(uuid,uuid,boolean),public.purge_operational_telemetry(integer) from public,anon,authenticated;
grant execute on function public.raise_operational_alert(text,text,bigint,uuid),public.finish_operational_run(uuid,boolean,integer,jsonb),public.check_operational_health(integer,integer,integer),public.claim_operational_alerts(integer),public.finish_operational_alert_delivery(uuid,uuid,boolean),public.purge_operational_telemetry(integer) to service_role;

commit;


