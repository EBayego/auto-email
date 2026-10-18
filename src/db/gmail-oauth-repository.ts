import type { GmailOAuthStore } from '@/modules/gmail/oauth';
import { GmailOAuthError } from '@/modules/gmail/errors';
import { DataAccessError, requireUuid } from './errors';
import type { DataClient } from './models';
import { createOwnerRepositories } from './repositories';
import { randomUUID } from 'node:crypto';

export function createGmailOAuthRepository(
  client: DataClient,
  userId: string,
  sessionId: string,
): GmailOAuthStore {
  requireUuid(userId);
  requireUuid(sessionId);
  let consumedVersion: string | null | undefined;
  const authorize = async () => {
    const profile = await createOwnerRepositories(client, userId).users.get();
    if (!profile || profile.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
  };
  return Object.freeze({
    async beginAttempt({ stateHash, codeVerifier, expiresAt }) {
      await authorize();
      const current = await client
        .from('gmail_accounts')
        .select('credential_version,status,encrypted_refresh_token')
        .eq('user_id', userId)
        .maybeSingle();
      if (current.error) throw new DataAccessError('UNAVAILABLE');
      if (
        current.data?.status === 'DISCONNECTED' &&
        current.data.encrypted_refresh_token
      )
        throw new GmailOAuthError('DISCONNECT_PENDING');
      const { error } = await client.from('gmail_oauth_attempts').upsert(
        {
          user_id: userId,
          session_id: sessionId,
          state_hash: stateHash,
          code_verifier: codeVerifier,
          expires_at: expiresAt,
          credential_version: current.data?.credential_version ?? null,
        },
        { onConflict: 'user_id' },
      );
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
    async consumeAttempt(stateHash) {
      await authorize();
      const { data, error } = await client
        .from('gmail_oauth_attempts')
        .delete()
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .eq('state_hash', stateHash)
        .gt('expires_at', new Date().toISOString())
        .select('code_verifier,credential_version')
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      consumedVersion = data ? data.credential_version : undefined;
      return data?.code_verifier ?? null;
    },
    async connectAccount({
      email,
      scopes,
      encryptedRefreshToken,
      encryptedAccessToken,
      accessTokenExpiresAt,
    }) {
      await authorize();
      if (consumedVersion === undefined)
        throw new GmailOAuthError('INVALID_STATE');
      const values = {
        user_id: userId,
        email,
        scope_set: [...scopes],
        encrypted_refresh_token: encryptedRefreshToken,
        status: 'CONNECTED',
        encrypted_access_token: encryptedAccessToken ?? null,
        access_token_expires_at: accessTokenExpiresAt ?? null,
        credential_version: randomUUID(),
        token_lease_id: null,
        token_lease_expires_at: null,
      };
      if (consumedVersion === null) {
        const inserted = await client.from('gmail_accounts').insert(values);
        if (inserted.error) {
          if (inserted.error.code === '23505')
            throw new GmailOAuthError('ACCOUNT_IN_USE');
          throw new DataAccessError('UNAVAILABLE');
        }
        return;
      }
      const updated = await client
        .from('gmail_accounts')
        .update(values)
        .eq('user_id', userId)
        .eq('email', email)
        .eq('credential_version', consumedVersion)
        .select('id')
        .maybeSingle();
      if (updated.error) throw new DataAccessError('UNAVAILABLE');
      if (!updated.data) {
        const current = await client
          .from('gmail_accounts')
          .select('email')
          .eq('user_id', userId)
          .maybeSingle();
        if (current.error) throw new DataAccessError('UNAVAILABLE');
        throw new GmailOAuthError(
          current.data?.email === email ? 'INVALID_STATE' : 'ACCOUNT_MISMATCH',
        );
      }
    },
  });
}
