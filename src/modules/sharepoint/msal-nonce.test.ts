import { describe, expect, it, vi } from 'vitest';
import {
  ConfidentialClientApplication,
  type NetworkResponse,
} from '@azure/msal-node';

const tenant = '00000000-0000-4000-8000-000000000302';
const clientId = '00000000-0000-4000-8000-000000000301';
const origin = 'https://login.microsoftonline.com';
const nonce = 'fixture-request-nonce';
const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function application() {
  const post = vi.fn(async <T>(): Promise<NetworkResponse<T>> => ({
    status: 200,
    headers: {},
    body: {
      token_type: 'Bearer',
      scope: 'Sites.Read.All openid profile',
      expires_in: 3600,
      access_token: 'fixture-access-token',
      refresh_token: 'fixture-refresh-token',
      client_info: encode({ uid: clientId, utid: tenant }),
      id_token: [
        encode({ alg: 'RS256', typ: 'JWT' }),
        encode({
          aud: clientId,
          iss: `${origin}/${tenant}/v2.0`,
          tid: tenant,
          oid: clientId,
          sub: clientId,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce,
          preferred_username: 'fixture@example.invalid',
        }),
        'fixture-signature',
      ].join('.'),
    } as T,
  }));
  const app = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret: 'fixture-secret',
      authority: `${origin}/${tenant}`,
      authorityMetadata: JSON.stringify({
        authorization_endpoint: `${origin}/${tenant}/oauth2/v2.0/authorize`,
        token_endpoint: `${origin}/${tenant}/oauth2/v2.0/token`,
        end_session_endpoint: `${origin}/${tenant}/oauth2/v2.0/logout`,
        issuer: `${origin}/${tenant}/v2.0`,
        jwks_uri: `${origin}/${tenant}/discovery/v2.0/keys`,
      }),
      cloudDiscoveryMetadata: JSON.stringify({
        tenant_discovery_endpoint: `${origin}/${tenant}/v2.0/.well-known/openid-configuration`,
        metadata: [
          {
            preferred_network: 'login.microsoftonline.com',
            preferred_cache: 'login.windows.net',
            aliases: ['login.microsoftonline.com', 'login.windows.net'],
          },
        ],
      }),
    },
    system: {
      loggerOptions: { piiLoggingEnabled: false, loggerCallback() {} },
      networkClient: {
        sendGetRequestAsync: async () => {
          throw new Error('Unexpected discovery request');
        },
        sendPostRequestAsync: async <T>(): Promise<NetworkResponse<T>> => {
          const response = await post();
          return { ...response, body: response.body as T };
        },
      },
    },
  });
  return { app, post };
}
const request = {
  code: 'fixture-code',
  scopes: ['https://graph.microsoft.com/Sites.Read.All'],
  redirectUri: 'http://localhost:3000/api/connectors/microsoft/callback',
  codeVerifier: 'v'.repeat(64),
};

describe('contrato nonce con la versión instalada de MSAL, sin red real', () => {
  it('reproduce el rechazo cuando se omite el nonce de la solicitud original', async () => {
    const { app, post } = application();
    await expect(app.acquireTokenByCode(request)).rejects.toMatchObject({
      errorCode: 'nonce_mismatch',
    });
    expect(post).toHaveBeenCalledOnce();
  });
  it('acepta el mismo retorno al proporcionar el nonce original', async () => {
    const { app } = application();
    await expect(
      app.acquireTokenByCode({ ...request, nonce }),
    ).resolves.toMatchObject({ tenantId: tenant, idTokenClaims: { nonce } });
  });
  it('sigue rechazando un nonce que no coincide', async () => {
    const { app } = application();
    await expect(
      app.acquireTokenByCode({ ...request, nonce: 'different' }),
    ).rejects.toMatchObject({ errorCode: 'nonce_mismatch' });
  });
});
