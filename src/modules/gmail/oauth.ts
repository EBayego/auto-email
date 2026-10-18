import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import type { ProviderClients } from '@/providers/contracts';
import { GmailOAuthError } from './errors';
import { encryptGmailRefreshToken } from './tokens';

export const gmailOAuthLifetimeSeconds = 600;
export const gmailOAuthCookie = 'auto-email-gmail-oauth';

export type GmailOAuthStore = {
  beginAttempt(input: {
    stateHash: string;
    codeVerifier: string;
    expiresAt: string;
  }): Promise<void>;
  consumeAttempt(stateHash: string): Promise<string | null>;
  connectAccount(input: {
    email: string;
    scopes: readonly string[];
    encryptedRefreshToken: string;
    encryptedAccessToken?: string;
    accessTokenExpiresAt?: string;
  }): Promise<void>;
};

export const hashOAuthState = (state: string) =>
  createHash('sha256').update(state).digest('hex');

export function createGmailOAuthService(input: {
  userId: string;
  store: GmailOAuthStore;
  providers: Pick<ProviderClients, 'googleAuthorization' | 'gmail'>;
  encryptionKey: SecretValue;
}) {
  const { store, providers } = input;
  return Object.freeze({
    async begin() {
      const state = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(32).toString('base64url');
      const url = providers.googleAuthorization.getAuthorizationUrl({
        state,
        codeChallenge: createHash('sha256')
          .update(codeVerifier)
          .digest('base64url'),
      });
      await store.beginAttempt({
        stateHash: hashOAuthState(state),
        codeVerifier,
        expiresAt: new Date(
          Date.now() + gmailOAuthLifetimeSeconds * 1000,
        ).toISOString(),
      });
      return { state, url };
    },
    async complete(params: URLSearchParams, cookieState: string | undefined) {
      const state = params.get('state');
      if (
        !state ||
        !cookieState ||
        !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(cookieState) ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(cookieState)) ||
        ['state', 'code', 'error'].some((key) => params.getAll(key).length > 1)
      )
        throw new GmailOAuthError('INVALID_STATE');
      const codeVerifier = await store.consumeAttempt(hashOAuthState(state));
      if (!codeVerifier) throw new GmailOAuthError('INVALID_STATE');
      if (params.has('error'))
        throw new GmailOAuthError(
          params.get('error') === 'access_denied'
            ? 'CANCELLED'
            : 'AUTHORIZATION_FAILED',
        );
      const code = params.get('code');
      if (!code) throw new GmailOAuthError('AUTHORIZATION_FAILED');

      const requestedAt = Date.now();
      const tokens = await providers.googleAuthorization.exchangeCode({
        code,
        codeVerifier,
      });
      if (!gmailScopes.every((scope) => tokens.scopes.includes(scope)))
        throw new GmailOAuthError('MISSING_SCOPES');
      if (!tokens.refreshToken)
        throw new GmailOAuthError('REFRESH_TOKEN_REQUIRED');
      const profile = await providers
        .gmail(async () => tokens.accessToken.reveal())
        .get('profile');
      const address =
        profile && typeof profile === 'object' && 'emailAddress' in profile
          ? profile.emailAddress
          : undefined;
      if (
        typeof address !== 'string' ||
        address.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
      )
        throw new GmailOAuthError('INVALID_PROFILE');
      const email = address.toLowerCase();
      await store.connectAccount({
        email,
        scopes: tokens.scopes,
        encryptedAccessToken: encryptGmailRefreshToken(
          tokens.accessToken,
          input.encryptionKey,
          input.userId,
          email,
          'access',
        ),
        accessTokenExpiresAt: new Date(
          requestedAt + tokens.expiresInSeconds * 1000,
        ).toISOString(),
        encryptedRefreshToken: encryptGmailRefreshToken(
          tokens.refreshToken,
          input.encryptionKey,
          input.userId,
          email,
        ),
      });
    },
  });
}
