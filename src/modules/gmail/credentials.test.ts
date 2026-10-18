import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import type {
  GmailClient,
  GmailTransport,
  GoogleAuthorizationClient,
  ProviderClients,
} from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { withMessageQueries } from '@/providers/gmail-messages';
import { createGmailClient } from '@/providers/gmail';
import {
  createGmailConnection,
  type GmailCredential,
  type GmailCredentialStore,
} from './credentials';
import { encryptGmailRefreshToken, decryptGmailRefreshToken } from './tokens';

const key = new SecretValue(Buffer.alloc(32, 13).toString('base64'));
const userId = '00000000-0000-4000-8000-000000000013';
const accountId = '10000000-0000-4000-8000-000000000013';
const email = 'mail013@example.invalid';
const encrypt = (token: string, kind: 'refresh' | 'access') =>
  new SecretValue(
    encryptGmailRefreshToken(new SecretValue(token), key, userId, email, kind),
  );
const decrypt = (token: SecretValue, kind: 'refresh' | 'access') =>
  decryptGmailRefreshToken(token.reveal(), key, userId, email, kind).reveal();

function fixture() {
  let row: GmailCredential = {
    id: accountId,
    userId,
    email,
    status: 'CONNECTED',
    version: crypto.randomUUID(),
    scopes: gmailScopes,
    encryptedRefreshToken: encrypt('private-old-refresh', 'refresh'),
    encryptedAccessToken: null,
    accessTokenExpiresAt: null,
  };
  let lease: string | undefined;
  const matches = (value: GmailCredential) => value.version === row.version;
  const store = {
    get: vi.fn<GmailCredentialStore['get']>(async () => row),
    acquire: vi.fn<GmailCredentialStore['acquire']>(async (value, id) => {
      if (!matches(value) || lease || row.status !== 'CONNECTED') return false;
      lease = id;
      return true;
    }),
    save: vi.fn<GmailCredentialStore['save']>(async (value, id, tokens) => {
      if (!matches(value) || lease !== id || row.status !== 'CONNECTED')
        return false;
      row = {
        ...row,
        version: crypto.randomUUID(),
        encryptedAccessToken: new SecretValue(tokens.encryptedAccessToken),
        encryptedRefreshToken: new SecretValue(tokens.encryptedRefreshToken),
        accessTokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      };
      lease = undefined;
      return true;
    }),
    release: vi.fn<GmailCredentialStore['release']>(async (value, id) => {
      if (matches(value) && lease === id) lease = undefined;
    }),
    requireReauth: vi.fn<GmailCredentialStore['requireReauth']>(
      async (value, id) => {
        if (
          !matches(value) ||
          (id && lease !== id) ||
          row.status !== 'CONNECTED'
        )
          return false;
        row = {
          ...row,
          status: 'REAUTH_REQUIRED',
          version: crypto.randomUUID(),
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          accessTokenExpiresAt: null,
        };
        lease = undefined;
        return true;
      },
    ),
    invalidateAccess: vi.fn<GmailCredentialStore['invalidateAccess']>(
      async (value) => {
        if (matches(value))
          row = {
            ...row,
            encryptedAccessToken: null,
            accessTokenExpiresAt: null,
          };
      },
    ),
    beginDisconnect: vi.fn<GmailCredentialStore['beginDisconnect']>(
      async (value, id) => {
        if (!matches(value)) return null;
        row = {
          ...row,
          status: 'DISCONNECTED',
          version: crypto.randomUUID(),
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
          scopes: [],
        };
        lease = id;
        return row;
      },
    ),
    finishDisconnect: vi.fn<GmailCredentialStore['finishDisconnect']>(
      async (value, id) => {
        if (matches(value) && lease === id) {
          row = { ...row, encryptedRefreshToken: null };
          lease = undefined;
        }
      },
    ),
  } satisfies GmailCredentialStore;
  const refreshAccessToken = vi.fn<
    GoogleAuthorizationClient['refreshAccessToken']
  >(async () => ({
    accessToken: new SecretValue('private-new-access'),
    refreshToken: null,
    scopes: null,
    expiresInSeconds: 3600,
  }));
  const revokeToken = vi.fn<GoogleAuthorizationClient['revokeToken']>(
    async () => {},
  );
  const get = vi.fn<GmailClient['get']>(async () => ({ emailAddress: email }));
  const createDraft = vi.fn<GmailClient['createDraft']>(async () => ({
    id: 'draft',
  }));
  const providers = {
    googleAuthorization: {
      refreshAccessToken,
      revokeToken,
      exchangeCode: vi.fn(),
      getAuthorizationUrl: vi.fn(),
    },
    gmail: vi.fn<ProviderClients['gmail']>((token) =>
      withMessageQueries<GmailTransport>({
        get: async (...args) => {
          await token();
          return get(...args);
        },
        createDraft: async (...args) => {
          await token();
          return createDraft(...args);
        },
      }),
    ),
  };
  const pause = vi.fn(async () => {});
  const connection = () =>
    createGmailConnection({
      store,
      providers,
      encryptionKey: key,
      timeoutMs: 1000,
      pause,
    });
  return {
    store,
    providers,
    refreshAccessToken,
    revokeToken,
    get,
    createDraft,
    pause,
    connection,
    row: () => row,
    replace: (values: Partial<GmailCredential>) => {
      row = { ...row, ...values };
      lease = undefined;
    },
    cache: () => {
      row = {
        ...row,
        encryptedAccessToken: encrypt('private-cached-access', 'access'),
        accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    },
  };
}

describe('almacenamiento y ciclo de vida de tokens Gmail', () => {
  it.each(['list', 'detail', 'thread'])(
    'la consulta tipada %s renueva tras un 401 y repite la misma lectura una vez',
    async (operation) => {
      const f = fixture();
      f.cache();
      const ref = { id: 'message-14', threadId: 'thread-14' };
      const body =
        operation === 'list'
          ? { messages: [ref] }
          : operation === 'thread'
            ? { id: ref.threadId, messages: [ref] }
            : ref;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(Response.json(body));
      f.providers.gmail.mockImplementation((token) =>
        createGmailClient(token, 1000, fetcher),
      );
      const client = f.connection().client;
      const result =
        operation === 'list'
          ? await client.listMessages({ mailbox: 'sent', maxResults: 1 })
          : operation === 'thread'
            ? await client.getThread(ref.threadId, { format: 'minimal' })
            : await client.getMessage(ref.id, { format: 'minimal' });
      expect(result).toEqual(body);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(String(fetcher.mock.calls[0][0])).toBe(
        String(fetcher.mock.calls[1][0]),
      );
      expect(
        new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization'),
      ).toBe('Bearer private-cached-access');
      expect(
        new Headers(fetcher.mock.calls[1][1]?.headers).get('Authorization'),
      ).toBe('Bearer private-new-access');
      expect(f.refreshAccessToken).toHaveBeenCalledOnce();
      expect(f.row().status).toBe('CONNECTED');
    },
  );

  it('una cuota en el cliente real conserva la conexión y no renueva ni reintenta', async () => {
    const f = fixture();
    f.cache();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
          { status: 403 },
        ),
      );
    f.providers.gmail.mockImplementation((token) =>
      createGmailClient(token, 1000, fetcher),
    );
    await expect(f.connection().client.listMessages()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    expect(f.row().status).toBe('CONNECTED');
    expect(f.refreshAccessToken).not.toHaveBeenCalled();
    expect(f.store.invalidateAccess).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('el cliente real propaga REAUTH_REQUIRED sin ocultarlo como fallo de red', async () => {
    const f = fixture();
    f.refreshAccessToken.mockRejectedValue(
      new ProviderError('google', 'INVALID_GRANT'),
    );
    const fetcher = vi.fn<typeof fetch>();
    f.providers.gmail.mockImplementation((token) =>
      createGmailClient(token, 1000, fetcher),
    );
    await expect(f.connection().client.listMessages()).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    expect(f.row().status).toBe('REAUTH_REQUIRED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('utiliza un access token vigente sin renovar ni depender de una sesión de navegador', async () => {
    const f = fixture();
    f.cache();
    const token = await f.connection().getAccessToken();
    expect(token.reveal()).toBe('private-cached-access');
    expect(f.refreshAccessToken).not.toHaveBeenCalled();
    expect(JSON.stringify(f.row()) + inspect(f.row())).not.toContain(
      'private-cached-access',
    );
  });

  it('renueva antes de caducar, comparte la llamada concurrente y conserva el refresh token si Google no envía otro', async () => {
    const f = fixture();
    f.cache();
    f.replace({
      accessTokenExpiresAt: new Date(Date.now() + 30000).toISOString(),
    });
    const old = f.row().encryptedRefreshToken!.reveal();
    const connection = f.connection();
    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => connection.getAccessToken()),
    );
    expect(
      tokens.every((value) => value.reveal() === 'private-new-access'),
    ).toBe(true);
    expect(f.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(f.row().encryptedRefreshToken!.reveal()).toBe(old);
    expect(decrypt(f.row().encryptedAccessToken!, 'access')).toBe(
      'private-new-access',
    );
    expect(
      Date.parse(f.row().accessTokenExpiresAt!) - Date.now(),
    ).toBeGreaterThan(3500000);
  });

  it('cifra el refresh token rotado y los siguientes procesos utilizan el nuevo', async () => {
    const f = fixture();
    f.refreshAccessToken.mockResolvedValue({
      accessToken: new SecretValue('private-new-access'),
      refreshToken: new SecretValue('private-rotated-refresh'),
      scopes: gmailScopes,
      expiresInSeconds: 3600,
    });
    await f.connection().getAccessToken();
    expect(decrypt(f.row().encryptedRefreshToken!, 'refresh')).toBe(
      'private-rotated-refresh',
    );
    f.replace({ encryptedAccessToken: null, accessTokenExpiresAt: null });
    await f.connection().getAccessToken();
    expect(f.refreshAccessToken.mock.calls[1][0].reveal()).toBe(
      'private-rotated-refresh',
    );
  });

  it('invalid_grant elimina credenciales, exige reconectar y no provoca reintentos posteriores', async () => {
    const f = fixture();
    f.refreshAccessToken.mockRejectedValue(
      new ProviderError('google', 'INVALID_GRANT'),
    );
    const connection = f.connection();
    await expect(connection.getAccessToken()).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    await expect(connection.getAccessToken()).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    expect(f.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(f.row()).toMatchObject({
      status: 'REAUTH_REQUIRED',
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
    });
  });

  it.each([
    'UNAVAILABLE',
    'RATE_LIMITED',
    'AUTHENTICATION_FAILED',
    'INVALID_RESPONSE',
  ] as const)(
    'no confunde %s con una revocación ni reintenta automáticamente',
    async (code) => {
      const f = fixture();
      f.refreshAccessToken.mockRejectedValue(new ProviderError('google', code));
      await expect(f.connection().getAccessToken()).rejects.toMatchObject({
        code,
      });
      expect(f.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(f.row().status).toBe('CONNECTED');
      expect(f.row().encryptedRefreshToken).not.toBeNull();
      expect(f.store.release).toHaveBeenCalledOnce();
    },
  );

  it('detecta la retirada parcial de scopes', async () => {
    const f = fixture();
    f.refreshAccessToken.mockResolvedValue({
      accessToken: new SecretValue('private-new-access'),
      refreshToken: null,
      scopes: [gmailScopes[0]],
      expiresInSeconds: 3600,
    });
    await expect(f.connection().getAccessToken()).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    expect(f.store.save).not.toHaveBeenCalled();
  });

  it.each(['success', 'invalid_grant'])(
    'un resultado antiguo (%s) no pisa una reconexión reciente',
    async (result) => {
      const f = fixture();
      f.refreshAccessToken.mockImplementation(async () => {
        f.replace({
          version: crypto.randomUUID(),
          encryptedRefreshToken: encrypt(
            'private-reconnected-refresh',
            'refresh',
          ),
          encryptedAccessToken: encrypt('private-reconnected-access', 'access'),
          accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        });
        if (result === 'invalid_grant')
          throw new ProviderError('google', 'INVALID_GRANT');
        return {
          accessToken: new SecretValue('private-stale-access'),
          refreshToken: new SecretValue('private-stale-refresh'),
          scopes: null,
          expiresInSeconds: 3600,
        };
      });
      expect((await f.connection().getAccessToken()).reveal()).toBe(
        'private-reconnected-access',
      );
      expect(f.row().status).toBe('CONNECTED');
      expect(decrypt(f.row().encryptedRefreshToken!, 'refresh')).toBe(
        'private-reconnected-refresh',
      );
    },
  );

  it('una renovación tardía no reactiva una cuenta desconectada', async () => {
    const f = fixture();
    const connection = f.connection();
    f.refreshAccessToken.mockImplementation(async () => {
      await connection.disconnect();
      return {
        accessToken: new SecretValue('private-stale-access'),
        refreshToken: null,
        scopes: null,
        expiresInSeconds: 3600,
      };
    });
    await expect(connection.getAccessToken()).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(f.row()).toMatchObject({
      status: 'DISCONNECTED',
      encryptedRefreshToken: null,
      encryptedAccessToken: null,
    });
  });

  it('la desconexión revoca en Google, elimina credenciales y devuelve solo el resultado', async () => {
    const f = fixture();
    f.cache();
    const connection = f.connection();
    expect(await connection.disconnect()).toEqual({ revoked: true });
    expect(f.revokeToken.mock.calls[0][0].reveal()).toBe('private-old-refresh');
    expect(f.row()).toMatchObject({
      status: 'DISCONNECTED',
      encryptedRefreshToken: null,
      encryptedAccessToken: null,
      scopes: [],
    });
    await expect(connection.getAccessToken()).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    await connection.disconnect();
    expect(f.revokeToken).toHaveBeenCalledTimes(1);
  });

  it('si falla la revocación remota desactiva la cuenta y borra tokens sin afirmar que se han revocado', async () => {
    const f = fixture();
    f.revokeToken.mockRejectedValue(new Error('private-provider-detail'));
    expect(await f.connection().disconnect()).toEqual({ revoked: false });
    expect(f.row()).toMatchObject({
      status: 'DISCONNECTED',
      encryptedRefreshToken: null,
    });
  });
  it('no confirma una revocación si ya no dispone de un token con el que solicitarla', async () => {
    const f = fixture();
    f.replace({ status: 'REAUTH_REQUIRED', encryptedRefreshToken: null });
    expect(await f.connection().disconnect()).toEqual({ revoked: false });
    expect(f.revokeToken).not.toHaveBeenCalled();
  });

  it('un bloqueo ocupado tiene espera limitada', async () => {
    const f = fixture();
    f.store.acquire.mockResolvedValue(false);
    await expect(f.connection().getAccessToken()).rejects.toMatchObject({
      code: 'TOKEN_BUSY',
    });
    expect(f.store.acquire).toHaveBeenCalledTimes(10);
    expect(f.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('un 401 permite renovar y repetir una lectura una sola vez', async () => {
    const f = fixture();
    f.cache();
    f.get.mockRejectedValueOnce(
      new ProviderError('google', 'ACCESS_TOKEN_REJECTED'),
    );
    expect(await f.connection().client.get('profile')).toEqual({
      emailAddress: email,
    });
    expect(f.get).toHaveBeenCalledTimes(2);
    expect(f.refreshAccessToken).toHaveBeenCalledOnce();
  });

  it('dos rechazos 401 exigen reconectar y una escritura nunca se reintenta', async () => {
    const f = fixture();
    f.cache();
    f.get.mockRejectedValue(
      new ProviderError('google', 'ACCESS_TOKEN_REJECTED'),
    );
    await expect(f.connection().client.get('profile')).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    expect(f.get).toHaveBeenCalledTimes(2);
    const g = fixture();
    g.cache();
    g.createDraft.mockRejectedValue(
      new ProviderError('google', 'ACCESS_TOKEN_REJECTED'),
    );
    await expect(
      g.connection().client.createDraft({ raw: 'dGVzdA' }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(g.createDraft).toHaveBeenCalledOnce();
    expect(g.refreshAccessToken).not.toHaveBeenCalled();
  });

  it.each(['DISCONNECTED', 'PAUSED', 'REAUTH_REQUIRED'])(
    'no utiliza una cuenta %s',
    async (status) => {
      const f = fixture();
      f.cache();
      f.replace({ status });
      await expect(f.connection().getAccessToken()).rejects.toThrow();
      expect(f.refreshAccessToken).not.toHaveBeenCalled();
    },
  );
});
