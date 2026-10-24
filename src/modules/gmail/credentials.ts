import { randomUUID } from 'node:crypto';
import type { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import type { GmailClient, ProviderClients } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { withMessageQueries } from '@/providers/gmail-messages';
import { decryptGmailRefreshToken, encryptGmailRefreshToken } from './tokens';

export type GmailCredential = Readonly<{
  id: string;
  userId: string;
  email: string;
  status: string;
  version: string;
  scopes: readonly string[];
  encryptedRefreshToken: SecretValue | null;
  encryptedAccessToken: SecretValue | null;
  accessTokenExpiresAt: string | null;
}>;
export type GmailCredentialStore = {
  get(): Promise<GmailCredential>;
  acquire(
    value: GmailCredential,
    leaseId: string,
    expiresAt: string,
  ): Promise<boolean>;
  save(
    value: GmailCredential,
    leaseId: string,
    tokens: {
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      expiresAt: string;
      scopes: readonly string[];
    },
  ): Promise<boolean>;
  release(value: GmailCredential, leaseId: string): Promise<void>;
  requireReauth(value: GmailCredential, leaseId?: string): Promise<boolean>;
  invalidateAccess(value: GmailCredential): Promise<void>;
  beginDisconnect(
    value: GmailCredential,
    leaseId: string,
    expiresAt: string,
  ): Promise<GmailCredential | null>;
  finishDisconnect(value: GmailCredential, leaseId: string): Promise<void>;
};
export class GmailCredentialError extends Error {
  constructor(
    public readonly code:
      | 'REAUTH_REQUIRED'
      | 'NOT_CONNECTED'
      | 'PAUSED'
      | 'TOKEN_BUSY'
      | 'UNAVAILABLE',
  ) {
    super(code);
    this.name = 'GmailCredentialError';
  }
}

export function createGmailConnection(input: {
  store: GmailCredentialStore;
  providers: Pick<ProviderClients, 'googleAuthorization' | 'gmail'>;
  encryptionKey: SecretValue;
  timeoutMs: number;
  pause?: (ms: number) => Promise<void>;
}) {
  const { store, providers, encryptionKey } = input;
  const pause =
    input.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const leaseExpiration = () =>
    new Date(Date.now() + input.timeoutMs * 2 + 10000).toISOString();
  const decrypt = (
    value: SecretValue,
    account: GmailCredential,
    kind: 'access' | 'refresh',
  ) =>
    decryptGmailRefreshToken(
      value.reveal(),
      encryptionKey,
      account.userId,
      account.email,
      kind,
    );
  const encrypt = (
    value: SecretValue,
    account: GmailCredential,
    kind: 'access' | 'refresh',
  ) =>
    encryptGmailRefreshToken(
      value,
      encryptionKey,
      account.userId,
      account.email,
      kind,
    );

  const obtain = async (): Promise<SecretValue> => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const account = await store.get();
      if (account.status === 'REAUTH_REQUIRED')
        throw new GmailCredentialError('REAUTH_REQUIRED');
      if (account.status === 'PAUSED') throw new GmailCredentialError('PAUSED');
      if (account.status !== 'CONNECTED')
        throw new GmailCredentialError('NOT_CONNECTED');
      if (
        !account.encryptedRefreshToken ||
        !gmailScopes.every((scope) => account.scopes.includes(scope))
      ) {
        if (await store.requireReauth(account))
          throw new GmailCredentialError('REAUTH_REQUIRED');
        continue;
      }
      if (
        account.encryptedAccessToken &&
        Date.parse(account.accessTokenExpiresAt ?? '') > Date.now() + 60000
      )
        return decrypt(account.encryptedAccessToken, account, 'access');
      const leaseId = randomUUID();
      if (!(await store.acquire(account, leaseId, leaseExpiration()))) {
        await pause(200);
        continue;
      }
      try {
        const requestedAt = Date.now();
        const tokens = await providers.googleAuthorization.refreshAccessToken(
          decrypt(account.encryptedRefreshToken, account, 'refresh'),
        );
        const scopes = tokens.scopes ?? account.scopes;
        if (!gmailScopes.every((scope) => scopes.includes(scope))) {
          if (await store.requireReauth(account, leaseId))
            throw new GmailCredentialError('REAUTH_REQUIRED');
          continue;
        }
        const saved = await store.save(account, leaseId, {
          encryptedAccessToken: encrypt(tokens.accessToken, account, 'access'),
          encryptedRefreshToken: tokens.refreshToken
            ? encrypt(tokens.refreshToken, account, 'refresh')
            : account.encryptedRefreshToken.reveal(),
          expiresAt: new Date(
            requestedAt + tokens.expiresInSeconds * 1000,
          ).toISOString(),
          scopes,
        });
        if (saved) {
          const current = await store.get();
          if (current.status !== 'CONNECTED')
            throw new GmailCredentialError('NOT_CONNECTED');
          if (
            current.encryptedAccessToken &&
            Date.parse(current.accessTokenExpiresAt ?? '') > Date.now()
          )
            return decrypt(current.encryptedAccessToken, current, 'access');
        }
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'INVALID_GRANT') {
          if (await store.requireReauth(account, leaseId))
            throw new GmailCredentialError('REAUTH_REQUIRED');
          continue;
        }
        throw error;
      } finally {
        await store.release(account, leaseId).catch(() => {});
      }
    }
    throw new GmailCredentialError('TOKEN_BUSY');
  };
  let pending: Promise<SecretValue> | undefined;
  const getAccessToken = () => {
    pending ??= obtain().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const rejected = async (used: SecretValue | undefined, final: boolean) => {
    const current = await store.get();
    if (
      current.status !== 'CONNECTED' ||
      !current.encryptedAccessToken ||
      !used
    )
      return;
    if (
      decrypt(current.encryptedAccessToken, current, 'access').reveal() !==
      used.reveal()
    )
      return;
    if (final) await store.requireReauth(current);
    else await store.invalidateAccess(current);
  };
  const call = async <T>(
    operation: (client: GmailClient) => Promise<T>,
    retryRead: boolean,
  ): Promise<T> => {
    for (let attempt = 0; attempt < (retryRead ? 2 : 1); attempt++) {
      let used: SecretValue | undefined;
      const client = providers.gmail(async () => {
        used = await getAccessToken();
        return used.reveal();
      });
      try {
        return await operation(client);
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          error.code !== 'ACCESS_TOKEN_REJECTED'
        )
          throw error;
        await rejected(used, retryRead && attempt === 1);
        if (retryRead && attempt === 0) continue;
        throw new GmailCredentialError(
          retryRead ? 'REAUTH_REQUIRED' : 'UNAVAILABLE',
        );
      }
    }
    throw new GmailCredentialError('UNAVAILABLE');
  };
  const client = withMessageQueries({
    get: (resource, query) => call((gmail) => gmail.get(resource, query), true),
    createDraft: (message, guard) =>
      call((gmail) => gmail.createDraft(message, guard), false),
  });
  return Object.freeze({
    client,
    getAccessToken,
    async disconnect(): Promise<{ revoked: boolean }> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const value = await store.get();
        const leaseId = randomUUID();
        const stopped = await store.beginDisconnect(
          value,
          leaseId,
          leaseExpiration(),
        );
        if (!stopped) continue;
        let revoked = false;
        try {
          if (stopped.encryptedRefreshToken) {
            await providers.googleAuthorization.revokeToken(
              decrypt(stopped.encryptedRefreshToken, stopped, 'refresh'),
            );
            revoked = true;
          }
        } catch {
          revoked = false;
        }
        await store.finishDisconnect(stopped, leaseId);
        return { revoked };
      }
      throw new GmailCredentialError('TOKEN_BUSY');
    },
  });
}
