-- Reconcile configured disclosure before claiming any background work, including
-- local comparison and learning that do not make a provider request.
create or replace function public.enforce_privacy_configuration(p_notice_hash text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare owner_id uuid;
begin
  if p_notice_hash is not null and p_notice_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
  for owner_id in select u.id from public.users u where u.status='ACTIVE'
    and exists(select 1 from public.gmail_accounts a where a.user_id=u.id and a.status='CONNECTED')
    and (p_notice_hash is null or not public.privacy_authorization_valid(u.id,p_notice_hash))
    order by u.id for update of u
  loop
    if p_notice_hash is not null and public.privacy_authorization_valid(owner_id,p_notice_hash) then continue; end if;
    update public.gmail_accounts set status='PAUSED',credential_version=gen_random_uuid(),encrypted_access_token=null,
      access_token_expires_at=null,token_lease_id=null,token_lease_expires_at=null where user_id=owner_id and status='CONNECTED';
    perform public.stop_account_work(owner_id,'ACCOUNT_DISCONNECTED');
  end loop;
  return true;
end;
$$;
revoke all on function public.enforce_privacy_configuration(text) from public,anon,authenticated;
grant execute on function public.enforce_privacy_configuration(text) to service_role;
