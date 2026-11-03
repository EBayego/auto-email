import {
  ConfidentialClientApplication,
  InteractionRequiredAuthError,
  ResponseMode,
} from '@azure/msal-node';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { SharePointConfig } from '@/config/sharepoint';
import { openMicrosoft, sealMicrosoft } from './crypto';
import {
  SharePointError,
  type MicrosoftConnection,
  type SharePointStore,
} from './contracts';

export const microsoftOAuthCookie = 'auto-email-microsoft-state';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function createMicrosoftAuth(
  config: SharePointConfig,
  store: SharePointStore,
  userId: string,
) {
  const scopes = [`https://graph.microsoft.com/${config.scope}`];
  const client = (
    tenant = config.tenants.length === 1 ? config.tenants[0] : 'organizations',
  ) =>
    new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret.reveal(),
        authority: `https://login.microsoftonline.com/${tenant}`,
      },
      system: {
        loggerOptions: { piiLoggingEnabled: false, loggerCallback() {} },
      },
    });
  return {
    async begin() {
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const cca = client();
      const url = await cca.getAuthCodeUrl({
        scopes: [...scopes, 'openid', 'profile', 'offline_access'],
        redirectUri: config.redirectUri,
        state,
        nonce,
        codeChallenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        codeChallengeMethod: 'S256',
        responseMode: ResponseMode.QUERY,
        prompt: 'select_account',
      });
      await store.command('oauth_put', {
        hash: hash(state),
        secret: sealMicrosoft(
          JSON.stringify({ verifier, nonce }),
          config.encryptionKey,
          userId,
        ),
      });
      return { state, url };
    },
    async complete(params: URLSearchParams, cookie?: string) {
      const state = params.get('state') ?? '';
      if (
        !cookie ||
        !/^[\w-]{43}$/.test(state) ||
        state.length !== cookie.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(cookie)) ||
        [...params.keys()].some((k) => params.getAll(k).length !== 1)
      )
        throw new SharePointError('INVALID_OAUTH_STATE');
      const secret = await store.command<string>('oauth_take', {
        hash: hash(state),
      });
      if (
        params.has('error') ||
        !params.get('code') ||
        params.get('code')!.length > 8192
      )
        throw new SharePointError('MICROSOFT_CONSENT_REQUIRED');
      const { verifier, nonce } = JSON.parse(
        openMicrosoft(secret, config.encryptionKey, userId),
      ) as { verifier: string; nonce: string };
      const cca = client();
      const result = await cca.acquireTokenByCode({
        code: params.get('code')!,
        scopes,
        redirectUri: config.redirectUri,
        codeVerifier: verifier,
        nonce,
      });
      const claims = result.idTokenClaims as Record<string, unknown>;
      if (
        !result.account ||
        !config.tenants.includes(result.tenantId) ||
        claims.nonce !== nonce ||
        claims.aud !== config.clientId ||
        claims.iss !==
          `https://login.microsoftonline.com/${result.tenantId}/v2.0`
      )
        throw new SharePointError('MICROSOFT_IDENTITY_REJECTED');
      if (
        !result.scopes.some(
          (s) =>
            s.toLowerCase().split('/').at(-1) === config.scope.toLowerCase(),
        )
      )
        throw new SharePointError('MICROSOFT_SCOPE_REQUIRED');
      const identity = `${userId}:${result.tenantId}:${result.account.homeAccountId}`;
      return store.command('connection_save', {
        tenant: result.tenantId,
        account: result.account.homeAccountId,
        username: result.account.username,
        cache: sealMicrosoft(
          cca.getTokenCache().serialize(),
          config.encryptionKey,
          identity,
        ),
      });
    },
    async token(connectionId: string) {
      const lease = randomUUID();
      const connection = await store.command<MicrosoftConnection>(
        'token_acquire',
        { id: connectionId, lease },
      );
      try {
        if (!config.tenants.includes(connection.tenant_id))
          throw new SharePointError('MICROSOFT_IDENTITY_REJECTED');
        const cca = client(connection.tenant_id);
        const owner = `${userId}:${connection.tenant_id}:${connection.account_id}`;
        cca
          .getTokenCache()
          .deserialize(
            openMicrosoft(connection.cache, config.encryptionKey, owner),
          );
        const account = await cca
          .getTokenCache()
          .getAccountByHomeId(connection.account_id);
        if (!account || account.tenantId !== connection.tenant_id)
          throw new SharePointError('REAUTH_REQUIRED');
        const result = await cca.acquireTokenSilent({ account, scopes });
        if (result.tenantId !== connection.tenant_id || !result.accessToken)
          throw new SharePointError('REAUTH_REQUIRED');
        await store.command('token_save', {
          id: connectionId,
          lease,
          cache: sealMicrosoft(
            cca.getTokenCache().serialize(),
            config.encryptionKey,
            owner,
          ),
        });
        return result.accessToken;
      } catch (error) {
        if (
          error instanceof InteractionRequiredAuthError ||
          (error instanceof SharePointError && error.code === 'REAUTH_REQUIRED')
        ) {
          await store.command('reauth', { id: connectionId });
          throw new SharePointError('REAUTH_REQUIRED');
        }
        throw new SharePointError('MICROSOFT_UNAVAILABLE');
      } finally {
        await store
          .command('token_release', { id: connectionId, lease })
          .catch(() => {});
      }
    },
  };
}
