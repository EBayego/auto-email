import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createMicrosoftAuth } from './auth';
import { openMicrosoft, sealMicrosoft } from './crypto';
import { SecretValue } from '@/config/env';
import type { SharePointStore } from './contracts';

const sdk = vi.hoisted(() => ({
  configuration: vi.fn(),
  url: vi.fn(),
  code: vi.fn(),
  silent: vi.fn(),
  serialize: vi.fn(() => '{"fixture":true}'),
  deserialize: vi.fn(),
  account: vi.fn(),
}));
vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: class {
    constructor(config: unknown) {
      sdk.configuration(config);
    }
    getAuthCodeUrl = sdk.url;
    acquireTokenByCode = sdk.code;
    acquireTokenSilent = sdk.silent;
    getTokenCache() {
      return {
        serialize: sdk.serialize,
        deserialize: sdk.deserialize,
        getAccountByHomeId: sdk.account,
      };
    }
  },
  InteractionRequiredAuthError: class extends Error {},
  ResponseMode: { QUERY: 'query' },
}));
const user = '00000000-0000-4000-8000-000000000301';
const tenant = '00000000-0000-4000-8000-000000000302';
const config = {
  clientId: user,
  clientSecret: new SecretValue('fixture'),
  encryptionKey: new SecretValue(Buffer.alloc(32, 5).toString('base64')),
  tenants: [tenant],
  scope: 'Sites.Read.All' as const,
  redirectUri: 'http://localhost:3000/api/connectors/microsoft/callback',
  timeoutMs: 30000,
  ocr: null,
};
function fixture() {
  let secret = '';
  let consumed = false;
  const command = vi
    .fn()
    .mockImplementation(
      async (action: string, input: Record<string, unknown>) => {
        if (action === 'oauth_put') {
          secret = String(input.secret);
          consumed = false;
          return true;
        }
        if (action === 'oauth_take') {
          if (consumed) throw new Error('INVALID_OAUTH_STATE');
          consumed = true;
          return secret;
        }
        if (action === 'connection_save') return { id: user };
        return true;
      },
    );
  return {
    command,
    store: { command } as SharePointStore,
    auth: createMicrosoftAuth(config, { command } as SharePointStore, user),
  };
}
describe('Microsoft OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.url.mockResolvedValue(
      'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
    );
  });
  it('guarda el verificador cifrado, envía PKCE S256 y solicita solo lectura', async () => {
    const f = fixture();
    const { state } = await f.auth.begin();
    expect(state).toHaveLength(43);
    expect(sdk.configuration).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          authority: `https://login.microsoftonline.com/${tenant}`,
        }),
      }),
    );
    const put = f.command.mock.calls[0][1];
    const secret = JSON.parse(
      openMicrosoft(put.secret, config.encryptionKey, user),
    );
    expect(put.secret).not.toContain(secret.verifier);
    expect(put.hash).toBe(createHash('sha256').update(state).digest('hex'));
    expect(sdk.url).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChallengeMethod: 'S256',
        codeChallenge: createHash('sha256')
          .update(secret.verifier)
          .digest('base64url'),
        state,
      }),
    );
    expect(sdk.url.mock.calls[0][0].scopes).not.toContain(
      'Sites.ReadWrite.All',
    );
  });
  it('rechaza cookie distinta, duplicados y callbacks sin estado sin consumir credenciales', async () => {
    const f = fixture();
    const { state } = await f.auth.begin();
    f.command.mockClear();
    await expect(
      f.auth.complete(
        new URLSearchParams({ state, code: 'code' }),
        'x'.repeat(43),
      ),
    ).rejects.toThrow('INVALID_OAUTH_STATE');
    await expect(
      f.auth.complete(
        new URLSearchParams(`state=${state}&state=${state}&code=code`),
        state,
      ),
    ).rejects.toThrow('INVALID_OAUTH_STATE');
    await expect(
      f.auth.complete(new URLSearchParams({ code: 'code' })),
    ).rejects.toThrow('INVALID_OAUTH_STATE');
    expect(f.command).not.toHaveBeenCalled();
  });
  it('valida nonce, emisor, audiencia y tenant antes de persistir la cuenta', async () => {
    const f = fixture();
    const { state } = await f.auth.begin();
    const nonce = sdk.url.mock.calls[0][0].nonce;
    sdk.code.mockResolvedValue({
      account: {
        homeAccountId: 'identity',
        username: 'fixture@example.invalid',
      },
      tenantId: tenant,
      scopes: ['Sites.Read.All'],
      idTokenClaims: {
        nonce,
        aud: user,
        iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
      },
    });
    await expect(
      f.auth.complete(new URLSearchParams({ state, code: 'code' }), state),
    ).resolves.toEqual({ id: user });
    const saved = f.command.mock.calls.find(
      (call) => call[0] === 'connection_save',
    )![1];
    expect(
      openMicrosoft(
        saved.cache,
        config.encryptionKey,
        `${user}:${tenant}:identity`,
      ),
    ).toBe('{"fixture":true}');
    await expect(
      f.auth.complete(new URLSearchParams({ state, code: 'code' }), state),
    ).rejects.toThrow('INVALID_OAUTH_STATE');
  });
  it.each(['nonce', 'aud', 'iss', 'tenant'])(
    'rechaza identidad con %s incorrecto',
    async (field) => {
      const f = fixture();
      const { state } = await f.auth.begin();
      const nonce = sdk.url.mock.calls[0][0].nonce;
      sdk.code.mockResolvedValue({
        account: { homeAccountId: 'identity', username: 'fixture' },
        tenantId: field === 'tenant' ? user : tenant,
        scopes: ['Sites.Read.All'],
        idTokenClaims: {
          nonce,
          aud: user,
          iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
          [field]: 'invalid',
        },
      });
      await expect(
        f.auth.complete(new URLSearchParams({ state, code: 'code' }), state),
      ).rejects.toThrow('MICROSOFT_IDENTITY_REJECTED');
      expect(
        f.command.mock.calls.some((call) => call[0] === 'connection_save'),
      ).toBe(false);
    },
  );
  it('renueva con la caché de la misma identidad y libera el bloqueo', async () => {
    const command = vi.fn().mockImplementation(async (action: string) =>
      action === 'token_acquire'
        ? {
            id: user,
            tenant_id: tenant,
            account_id: 'identity',
            cache: sealMicrosoft(
              '{"cached":true}',
              config.encryptionKey,
              `${user}:${tenant}:identity`,
            ),
          }
        : true,
    );
    sdk.account.mockResolvedValue({ tenantId: tenant });
    sdk.silent.mockResolvedValue({
      tenantId: tenant,
      accessToken: 'fixture-token',
    });
    await expect(
      createMicrosoftAuth(config, { command } as SharePointStore, user).token(
        user,
      ),
    ).resolves.toBe('fixture-token');
    expect(sdk.deserialize).toHaveBeenCalledWith('{"cached":true}');
    expect(command.mock.calls.map((c) => c[0])).toEqual([
      'token_acquire',
      'token_save',
      'token_release',
    ]);
  });
  it('marca reconexión si la identidad ya no está en la caché', async () => {
    const command = vi.fn().mockImplementation(async (action: string) =>
      action === 'token_acquire'
        ? {
            id: user,
            tenant_id: tenant,
            account_id: 'identity',
            cache: sealMicrosoft(
              '{}',
              config.encryptionKey,
              `${user}:${tenant}:identity`,
            ),
          }
        : true,
    );
    sdk.account.mockResolvedValue(null);
    await expect(
      createMicrosoftAuth(config, { command } as SharePointStore, user).token(
        user,
      ),
    ).rejects.toThrow('REAUTH_REQUIRED');
    expect(command.mock.calls.map((c) => c[0])).toEqual([
      'token_acquire',
      'reauth',
      'token_release',
    ]);
  });
});
