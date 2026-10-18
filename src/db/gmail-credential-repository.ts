import { randomUUID } from 'node:crypto';
import { SecretValue } from '@/config/env';
import type {
  GmailCredential,
  GmailCredentialStore,
} from '@/modules/gmail/credentials';
import { DataAccessError, requireResource, requireUuid } from './errors';
import type { DataClient } from './models';
import type { Tables, TablesUpdate } from './database.types';
import { createOwnerRepositories } from './repositories';

const columns =
  'id,user_id,email,status,scope_set,credential_version,encrypted_refresh_token,encrypted_access_token,access_token_expires_at';
function credential(
  row: Pick<
    Tables<'gmail_accounts'>,
    | 'id'
    | 'user_id'
    | 'email'
    | 'status'
    | 'scope_set'
    | 'credential_version'
    | 'encrypted_refresh_token'
    | 'encrypted_access_token'
    | 'access_token_expires_at'
  >,
): GmailCredential {
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    email: row.email,
    status: row.status,
    version: row.credential_version,
    scopes: Object.freeze(row.scope_set),
    encryptedRefreshToken: row.encrypted_refresh_token
      ? new SecretValue(row.encrypted_refresh_token)
      : null,
    encryptedAccessToken: row.encrypted_access_token
      ? new SecretValue(row.encrypted_access_token)
      : null,
    accessTokenExpiresAt: row.access_token_expires_at,
  });
}
export function createGmailCredentialRepository(
  client: DataClient,
  userId: string,
  accountId: string,
): GmailCredentialStore {
  requireUuid(userId);
  requireUuid(accountId);
  const authorize = async () => {
    const profile = await createOwnerRepositories(client, userId).users.get();
    if (!profile || profile.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
  };
  const update = (
    value: GmailCredential,
    values: TablesUpdate<'gmail_accounts'>,
  ) => {
    if (value.userId !== userId || value.id !== accountId)
      throw new DataAccessError('FORBIDDEN');
    return client
      .from('gmail_accounts')
      .update(values)
      .eq('user_id', userId)
      .eq('id', accountId)
      .eq('credential_version', value.version);
  };
  const changed = async (
    query: PromiseLike<{ data: { id: string } | null; error: unknown }>,
  ) => {
    const { data, error } = await query;
    if (error) throw new DataAccessError('UNAVAILABLE');
    return !!data;
  };
  const clearAccess = {
    encrypted_access_token: null,
    access_token_expires_at: null,
  };
  const clearLease = { token_lease_id: null, token_lease_expires_at: null };
  return Object.freeze({
    async get() {
      await authorize();
      const { data, error } = await client
        .from('gmail_accounts')
        .select(columns)
        .eq('user_id', userId)
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      if (data && (data.user_id !== userId || data.id !== accountId))
        throw new DataAccessError('UNAVAILABLE');
      return credential(requireResource(data));
    },
    async acquire(value, leaseId, expiresAt) {
      await authorize();
      return changed(
        update(value, {
          token_lease_id: leaseId,
          token_lease_expires_at: expiresAt,
        })
          .eq('status', 'CONNECTED')
          .or(
            `token_lease_id.is.null,token_lease_expires_at.lt.${new Date().toISOString()}`,
          )
          .select('id')
          .maybeSingle(),
      );
    },
    async save(value, leaseId, tokens) {
      await authorize();
      return changed(
        update(value, {
          encrypted_access_token: tokens.encryptedAccessToken,
          access_token_expires_at: tokens.expiresAt,
          encrypted_refresh_token: tokens.encryptedRefreshToken,
          scope_set: [...tokens.scopes],
          credential_version: randomUUID(),
          ...clearLease,
        })
          .eq('status', 'CONNECTED')
          .eq('token_lease_id', leaseId)
          .gt('token_lease_expires_at', new Date().toISOString())
          .select('id')
          .maybeSingle(),
      );
    },
    async release(value, leaseId) {
      await changed(
        update(value, clearLease)
          .eq('token_lease_id', leaseId)
          .select('id')
          .maybeSingle(),
      );
    },
    async requireReauth(value, leaseId) {
      await authorize();
      let query = update(value, {
        status: 'REAUTH_REQUIRED',
        encrypted_refresh_token: null,
        ...clearAccess,
        ...clearLease,
        credential_version: randomUUID(),
      }).eq('status', 'CONNECTED');
      if (leaseId) query = query.eq('token_lease_id', leaseId);
      return changed(query.select('id').maybeSingle());
    },
    async invalidateAccess(value) {
      await authorize();
      await changed(
        update(value, clearAccess)
          .eq('status', 'CONNECTED')
          .select('id')
          .maybeSingle(),
      );
    },
    async beginDisconnect(value, leaseId, expiresAt) {
      await authorize();
      const { data, error } = await update(value, {
        status: 'DISCONNECTED',
        ...clearAccess,
        token_lease_id: leaseId,
        token_lease_expires_at: expiresAt,
        credential_version: randomUUID(),
        scope_set: [],
      })
        .or(
          `status.neq.DISCONNECTED,token_lease_id.is.null,token_lease_expires_at.lt.${new Date().toISOString()}`,
        )
        .select(columns)
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      if (data && (data.user_id !== userId || data.id !== accountId))
        throw new DataAccessError('UNAVAILABLE');
      return data ? credential(data) : null;
    },
    async finishDisconnect(value, leaseId) {
      const { error: pendingError } = await client
        .from('gmail_oauth_attempts')
        .delete()
        .eq('user_id', userId);
      if (pendingError) throw new DataAccessError('UNAVAILABLE');
      await changed(
        update(value, {
          encrypted_refresh_token: null,
          ...clearAccess,
          ...clearLease,
        })
          .eq('status', 'DISCONNECTED')
          .eq('token_lease_id', leaseId)
          .select('id')
          .maybeSingle(),
      );
    },
  });
}
