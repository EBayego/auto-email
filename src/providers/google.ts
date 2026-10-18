import type { ServerConfig } from '@/config/env';
import { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import type { GoogleAuthorizationClient } from './contracts';
import { ProviderError, providerFailure } from './errors';

export { gmailScopes } from '@/config/google';

export function createGoogleAuthorizationClient(
  config: Extract<ServerConfig, { providerMode: 'live' }>['google'],
  timeoutMs = 30000,
  fetcher: typeof fetch = fetch,
): GoogleAuthorizationClient {
  return Object.freeze({
    getAuthorizationUrl({
      state,
      codeChallenge,
    }: Parameters<GoogleAuthorizationClient['getAuthorizationUrl']>[0]) {
      if (
        !/^[A-Za-z0-9_-]{32,512}$/.test(state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
      )
        throw new ProviderError('google', 'REQUEST_REJECTED');
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: gmailScopes.join(' '),
        access_type: 'offline',
        include_granted_scopes: 'false',
        prompt: 'consent',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }).toString();
      return url.href;
    },
    async exchangeCode({
      code,
      codeVerifier,
    }: Parameters<GoogleAuthorizationClient['exchangeCode']>[0]) {
      if (
        typeof code !== 'string' ||
        !code ||
        code.length > 2048 ||
        /\s/.test(code) ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)
      )
        throw new ProviderError('google', 'REQUEST_REJECTED');
      try {
        const response = await fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret.reveal(),
            redirect_uri: config.redirectUri,
            grant_type: 'authorization_code',
            code,
            code_verifier: codeVerifier,
          }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) throw providerFailure('google', response.status);
        const value = await response.json();
        const validToken = (token: unknown): token is string =>
          typeof token === 'string' &&
          token.length > 0 &&
          token.length <= 4096 &&
          !/\s/.test(token);
        if (
          !value ||
          value.token_type !== 'Bearer' ||
          !validToken(value.access_token) ||
          (value.refresh_token !== undefined &&
            !validToken(value.refresh_token)) ||
          typeof value.scope !== 'string' ||
          value.scope.length > 8192 ||
          !value.scope.trim() ||
          !Number.isInteger(value.expires_in) ||
          value.expires_in <= 0
        )
          throw new ProviderError('google', 'INVALID_RESPONSE');
        return Object.freeze({
          accessToken: new SecretValue(value.access_token),
          refreshToken: value.refresh_token
            ? new SecretValue(value.refresh_token)
            : null,
          expiresInSeconds: value.expires_in as number,
          scopes: Object.freeze([
            ...new Set<string>(value.scope.split(/\s+/).filter(Boolean)),
          ]),
        });
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof SyntaxError)
          throw new ProviderError('google', 'INVALID_RESPONSE');
        throw providerFailure('google');
      }
    },
    async refreshAccessToken(refreshToken: SecretValue) {
      try {
        const response = await fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret.reveal(),
            grant_type: 'refresh_token',
            refresh_token: refreshToken.reveal(),
          }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (response.status === 400 && body?.error === 'invalid_grant')
            throw new ProviderError('google', 'INVALID_GRANT');
          throw providerFailure('google', response.status);
        }
        const value = await response.json();
        const validToken = (token: unknown): token is string =>
          typeof token === 'string' &&
          token.length > 0 &&
          token.length <= 4096 &&
          !/\s/.test(token);
        if (
          !value ||
          value.token_type !== 'Bearer' ||
          !validToken(value.access_token) ||
          (value.refresh_token !== undefined &&
            !validToken(value.refresh_token)) ||
          (value.scope !== undefined &&
            (typeof value.scope !== 'string' ||
              !value.scope.trim() ||
              value.scope.length > 8192)) ||
          !Number.isInteger(value.expires_in) ||
          value.expires_in <= 0 ||
          value.expires_in > 86400
        )
          throw new ProviderError('google', 'INVALID_RESPONSE');
        return Object.freeze({
          accessToken: new SecretValue(value.access_token),
          refreshToken: value.refresh_token
            ? new SecretValue(value.refresh_token)
            : null,
          scopes:
            value.scope === undefined
              ? null
              : Object.freeze([
                  ...new Set<string>(value.scope.split(/\s+/).filter(Boolean)),
                ]),
          expiresInSeconds: value.expires_in as number,
        });
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error instanceof SyntaxError)
          throw new ProviderError('google', 'INVALID_RESPONSE');
        throw providerFailure('google');
      }
    },
    async revokeToken(token: SecretValue) {
      try {
        const response = await fetcher('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: token.reveal() }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
          redirect: 'error',
        });
        if (response.ok) return;
        const body = await response.json().catch(() => null);
        if (response.status === 400 && body?.error === 'invalid_token') return;
        throw providerFailure('google', response.status);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw providerFailure('google');
      }
    },
  });
}
