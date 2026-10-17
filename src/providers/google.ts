import type { ServerConfig } from '@/config/env';
import type { GoogleAuthorizationClient } from './contracts';
import { ProviderError } from './errors';

export const gmailScopes = Object.freeze([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
]);

export function createGoogleAuthorizationClient(
  config: Extract<ServerConfig, { providerMode: 'live' }>['google'],
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
  });
}
