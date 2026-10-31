create table public.account_data_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  action text not null check(action in ('GMAIL_DISCONNECTED','STYLE_DELETED','DOCUMENT_DELETED','ACCOUNT_DELETION_REQUESTED','ACCOUNT_DELETED')),
  created_at timestamptz not null default clock_timestamp()
);
create index account_data_events_owner_idx on public.account_data_events(user_id,created_at desc);
create index account_data_events_retention_idx on public.account_data_events(created_at);
alter table public.account_data_events enable row level security;
revoke all on public.account_data_events from public,anon,authenticated;
grant select,insert,delete on public.account_data_events to service_role;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users(id) on delete set null,
  receipt_hash text not null unique check(receipt_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','RETRY','COMPLETED')),
  phase text not null default 'REVOKE' check(phase in ('REVOKE','FILES','DATA','AUTH','COMPLETED')),
  revocation text not null default 'PENDING' check(revocation in ('PENDING','CONFIRMED','UNCONFIRMED','NOT_CONNECTED')),
  error_code text check(error_code in ('STORAGE_UNAVAILABLE','DATABASE_UNAVAILABLE','AUTH_UNAVAILABLE','UNAVAILABLE')),
  attempts integer not null default 0 check(attempts>=0),
  requested_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_id uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  check((lease_id is null)=(lease_expires_at is null)),
  check((status='COMPLETED')=(completed_at is not null))
);
create index account_deletion_pending_idx on public.account_deletion_requests(next_attempt_at,id) where status<>'COMPLETED';
create index account_deletion_retention_idx on public.account_deletion_requests(completed_at) where status='COMPLETED';
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant select,insert,update,delete on public.account_deletion_requests to service_role;

create or replace function public.email_job_transition_allowed(p_from text,p_to text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(case p_from when 'PENDING' then p_to in ('CLASSIFYING','SKIPPED')
    when 'CLASSIFYING' then p_to in ('PENDING','SKIPPED','GENERATING','REVIEW_REQUIRED','FAILED')
    when 'GENERATING' then p_to in ('SKIPPED','DRAFT_CREATED','REVIEW_REQUIRED','FAILED')
    when 'FAILED' then p_to='PENDING' else false end,false);
$$;
create or replace function public.email_job_intervention_reason(p_status text,p_reason text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(case p_status when 'SKIPPED' then p_reason in ('EXISTING_MANUAL_DRAFT','EXISTING_SYSTEM_DRAFT','TARGET_ALREADY_PROCESSED','ALREADY_ANSWERED','TARGET_SUPERSEDED','TARGET_NOT_ELIGIBLE','ACCOUNT_DISCONNECTED','STYLE_DELETED','ACCOUNT_DELETION')
    when 'REVIEW_REQUIRED' then p_reason in ('DRAFT_RECONCILIATION_REQUIRED','DRAFT_ATTEMPT_CANCELLED','POSSIBLE_EXISTING_REPLY','THREAD_UNVERIFIABLE') else false end,false);
$$;
create function public.stop_account_work(p_user_id uuid,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_reason not in ('ACCOUNT_DISCONNECTED','STYLE_DELETED','ACCOUNT_DELETION') then raise exception 'INVALID_INPUT'; end if;
  update public.user_settings set automation_enabled=false where user_id=p_user_id;
  update public.email_jobs set status=case when status='GENERATING' then 'REVIEW_REQUIRED' else 'SKIPPED' end,
    reason_code=p_reason,finished_at=greatest(clock_timestamp(),coalesce(started_at,created_at)),lease_id=null,lease_expires_at=null
    where user_id=p_user_id and status in ('PENDING','CLASSIFYING','GENERATING');
  update public.processing_runs set status='CANCELLED',finished_at=greatest(clock_timestamp(),started_at),error_code=p_reason where user_id=p_user_id and status='RUNNING';
  update public.gmail_accounts set sync_lease_id=null,sync_lease_expires_at=null,manual_sync_requested_at=null,manual_processing_until=null where user_id=p_user_id;
  update public.gmail_onboarding set status='CANCELLED',error_code='CANCELLED',finished_at=clock_timestamp(),lease_id=null,lease_expires_at=null
    where user_id=p_user_id and status in ('QUEUED','SAMPLING','ANALYZING');
  delete from public.gmail_oauth_attempts where user_id=p_user_id;
end;
$$;
create function public.audit_account_disconnect() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status='DISCONNECTED' and old.status<>'DISCONNECTED' then
    perform public.stop_account_work(new.user_id,'ACCOUNT_DISCONNECTED');
    insert into public.account_data_events(user_id,action) values(new.user_id,'GMAIL_DISCONNECTED');
  end if;
  return new;
end;
$$;
create trigger gmail_accounts_stop_work after update of status on public.gmail_accounts for each row execute function public.audit_account_disconnect();
create function public.audit_document_removal() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.users where id=old.user_id) then
    insert into public.account_data_events(user_id,action) values(old.user_id,'DOCUMENT_DELETED');
  end if;
  return old;
end;
$$;
create trigger source_documents_audit_removal before delete on public.source_documents for each row execute function public.audit_document_removal();

create function public.delete_writing_identity(p_user_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.users where id=p_user_id and status='ACTIVE' for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  update public.gmail_accounts set status='PAUSED' where user_id=p_user_id and status='CONNECTED';
  perform public.stop_account_work(p_user_id,'STYLE_DELETED');
  delete from public.gmail_onboarding where user_id=p_user_id;
  delete from public.style_preferences where user_id=p_user_id;
  delete from public.style_relationships where user_id=p_user_id;
  delete from public.style_profiles where user_id=p_user_id;
  insert into public.account_data_events(user_id,action) values(p_user_id,'STYLE_DELETED');
  return true;
end;
$$;
create function public.request_account_deletion(p_user_id uuid,p_receipt_hash text) returns uuid language plpgsql security invoker set search_path='' as $$
declare request_id uuid; delay_until timestamptz;
begin
  if p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.users where id=p_user_id and status in ('ACTIVE','DELETION_PENDING') for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  select id into request_id from public.account_deletion_requests where user_id=p_user_id;
  if found then
    update public.account_deletion_requests set receipt_hash=p_receipt_hash where id=request_id;
    return request_id;
  end if;
  select coalesce(max(uploaded_at)+interval '5 minutes',clock_timestamp()) into delay_until from public.source_documents where user_id=p_user_id and status='PROCESSING';
  update public.users set status='DELETION_PENDING' where id=p_user_id;
  update public.gmail_accounts set status='DISCONNECTED',encrypted_access_token=null,access_token_expires_at=null,scope_set='{}',credential_version=gen_random_uuid() where user_id=p_user_id;
  perform public.stop_account_work(p_user_id,'ACCOUNT_DELETION');
  insert into public.account_deletion_requests(user_id,receipt_hash,next_attempt_at) values(p_user_id,p_receipt_hash,greatest(clock_timestamp(),delay_until)) returning id into request_id;
  insert into public.account_data_events(user_id,action) values(p_user_id,'ACCOUNT_DELETION_REQUESTED');
  return request_id;
end;
$$;
create function public.claim_account_deletion(p_request_id uuid default null) returns setof public.account_deletion_requests
language plpgsql security invoker set search_path='' as $$
begin
  return query with chosen as (select id from public.account_deletion_requests where status<>'COMPLETED' and next_attempt_at<=clock_timestamp()
    and (p_request_id is null or id=p_request_id) and (lease_id is null or lease_expires_at<clock_timestamp())
    order by next_attempt_at,id limit 1 for update skip locked)
  update public.account_deletion_requests r set status='RUNNING',attempts=attempts+1,lease_id=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',error_code=null
    from chosen where r.id=chosen.id returning r.*;
end;
$$;
create function public.advance_account_deletion(p_request_id uuid,p_lease_id uuid,p_phase text,p_revocation text,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare task public.account_deletion_requests%rowtype;
begin
  select * into task from public.account_deletion_requests where id=p_request_id and status='RUNNING' and lease_id=p_lease_id and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if p_phase not in ('REVOKE','FILES','DATA','AUTH','COMPLETED') or p_revocation not in ('PENDING','CONFIRMED','UNCONFIRMED','NOT_CONNECTED')
    or (p_error is not null and p_error not in ('STORAGE_UNAVAILABLE','DATABASE_UNAVAILABLE','AUTH_UNAVAILABLE','UNAVAILABLE')) then raise exception 'INVALID_INPUT'; end if;
  if p_error is null and p_phase='FILES' and task.user_id is not null then
    update public.gmail_accounts set encrypted_refresh_token=null,encrypted_access_token=null,access_token_expires_at=null,token_lease_id=null,token_lease_expires_at=null where user_id=task.user_id;
  end if;
  if p_error is null and p_phase='COMPLETED' and task.user_id is not null then raise exception 'DELETION_NOT_FINISHED'; end if;
  update public.account_deletion_requests set phase=p_phase,revocation=p_revocation,error_code=p_error,
    status=case when p_error is not null then 'RETRY' when p_phase='COMPLETED' then 'COMPLETED' else 'RUNNING' end,
    lease_id=case when p_error is not null or p_phase='COMPLETED' then null else lease_id end,
    lease_expires_at=case when p_error is not null or p_phase='COMPLETED' then null else clock_timestamp()+interval '5 minutes' end,
    completed_at=case when p_error is null and p_phase='COMPLETED' then clock_timestamp() else null end,
    next_attempt_at=case when p_error is not null then clock_timestamp()+interval '1 minute' else next_attempt_at end where id=task.id;
  if p_error is null and p_phase='COMPLETED' then insert into public.account_data_events(action) values('ACCOUNT_DELETED'); end if;
  return true;
end;
$$;
create function public.purge_account_data(p_request_id uuid,p_lease_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare target_user_id uuid;
begin
  select user_id into target_user_id from public.account_deletion_requests where id=p_request_id and status='RUNNING' and phase='DATA'
    and lease_id=p_lease_id and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if target_user_id is null then return true; end if;
  perform 1 from public.users where id=target_user_id and status='DELETION_PENDING' for update;
  if not found then return false; end if;
  if exists(select 1 from storage.objects where bucket_id='knowledge-documents' and name like target_user_id::text||'/%') then raise exception 'FILES_REMAIN'; end if;
  delete from public.source_rule_sources where user_id=target_user_id;
  delete from public.source_rules where user_id=target_user_id;
  delete from public.source_documents where user_id=target_user_id;
  delete from public.knowledge_sources where user_id=target_user_id;
  delete from public.gmail_accounts where user_id=target_user_id;
  delete from public.gmail_oauth_attempts where user_id=target_user_id;
  return true;
end;
$$;
create function public.purge_account_audit() returns void language sql security invoker set search_path='' as $$
  delete from public.account_data_events where created_at<clock_timestamp()-interval '30 days';
  delete from public.account_deletion_requests where status='COMPLETED' and completed_at<clock_timestamp()-interval '30 days';
$$;
revoke all on function public.stop_account_work(uuid,text),public.audit_account_disconnect(),public.audit_document_removal(),public.delete_writing_identity(uuid),public.request_account_deletion(uuid,text),public.claim_account_deletion(uuid),public.advance_account_deletion(uuid,uuid,text,text,text),public.purge_account_data(uuid,uuid),public.purge_account_audit() from public,anon,authenticated;
grant execute on function public.stop_account_work(uuid,text),public.audit_account_disconnect(),public.audit_document_removal(),public.delete_writing_identity(uuid),public.request_account_deletion(uuid,text),public.claim_account_deletion(uuid),public.advance_account_deletion(uuid,uuid,text,text,text),public.purge_account_data(uuid,uuid),public.purge_account_audit() to service_role;
