alter table public.gmail_accounts
  add column encrypted_access_token bytea,
  add column access_token_expires_at timestamptz,
  add column credential_version uuid not null default gen_random_uuid(),
  add column token_lease_id uuid,
  add column token_lease_expires_at timestamptz,
  add constraint gmail_accounts_access_token_pair check (
    (encrypted_access_token is null) = (access_token_expires_at is null)
    and (encrypted_access_token is null or octet_length(encrypted_access_token) > 29)
  ),
  add constraint gmail_accounts_token_lease_pair check (
    (token_lease_id is null) = (token_lease_expires_at is null)
  );

alter table public.gmail_oauth_attempts add column credential_version uuid;
