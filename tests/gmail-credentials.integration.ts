import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { createGmailConnection } from '@/modules/gmail/credentials';
import {
  encryptGmailRefreshToken,
  decryptGmailRefreshToken,
} from '@/modules/gmail/tokens';
import { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import { ProviderError } from '@/providers/errors';
import { withMessageQueries } from '@/providers/gmail-messages';
import type {
  GoogleAuthorizationClient,
  ProviderClients,
} from '@/providers/contracts';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const key = new SecretValue(Buffer.alloc(32, 13).toString('base64'));
const users: { id: string; accountId: string; email: string }[] = [];
const encrypt = (
  token: string,
  owner = users[0],
  kind: 'access' | 'refresh' = 'refresh',
) =>
  encryptGmailRefreshToken(
    new SecretValue(token),
    key,
    owner.id,
    owner.email,
    kind,
  );

describe('MAIL-013 con base real y workers sin sesión de navegador', () => {
  beforeAll(async () => {
    if (new URL(url).port !== '55321')
      throw new Error('Solo base temporal local.');
    for (let i = 0; i < 2; i++) {
      const email = `mail013-${crypto.randomUUID()}@example.invalid`;
      const user = await service.auth.admin.createUser({
        email,
        password: `Test-${crypto.randomUUID()}`,
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      const inserted = await service
        .from('gmail_accounts')
        .insert({ user_id: user.data.user!.id, email })
        .select('id')
        .single();
      expect(inserted.error).toBeNull();
      users.push({
        id: user.data.user!.id,
        accountId: inserted.data!.id,
        email,
      });
    }
  });
  afterAll(async () => {
    for (const user of users)
      expect((await service.auth.admin.deleteUser(user.id)).error).toBeNull();
  });
  beforeEach(async () => {
    for (const owner of users) {
      const r = await service
        .from('gmail_accounts')
        .update({
          status: 'CONNECTED',
          scope_set: [...gmailScopes],
          encrypted_refresh_token: encrypt('synthetic-private-refresh', owner),
          encrypted_access_token: null,
          access_token_expires_at: null,
          token_lease_id: null,
          token_lease_expires_at: null,
          credential_version: crypto.randomUUID(),
        })
        .eq('id', owner.accountId)
        .eq('user_id', owner.id);
      expect(r.error).toBeNull();
    }
  });
  const repo = (index = 0) =>
    createGmailCredentialRepository(
      service,
      users[index].id,
      users[index].accountId,
    );
  function fixture() {
    const refresh = vi.fn<GoogleAuthorizationClient['refreshAccessToken']>(
      async () => ({
        accessToken: new SecretValue('synthetic-private-access'),
        refreshToken: null,
        scopes: null,
        expiresInSeconds: 3600,
      }),
    );
    const revoke = vi.fn<GoogleAuthorizationClient['revokeToken']>(
      async () => {},
    );
    const providers = {
      googleAuthorization: {
        refreshAccessToken: refresh,
        revokeToken: revoke,
        exchangeCode: vi.fn(),
        getAuthorizationUrl: vi.fn(),
      },
      gmail: vi.fn<ProviderClients['gmail']>((token) =>
        withMessageQueries({
          get: async () => {
            await token();
            return { ready: true };
          },
          createDraft: vi.fn(),
        }),
      ),
    };
    const connection = () =>
      createGmailConnection({
        store: repo(),
        providers,
        encryptionKey: key,
        timeoutMs: 1000,
      });
    return { refresh, revoke, connection };
  }
  it('dos procesos renuevan una sola vez y recuperan el access token cifrado sin login', async () => {
    const f = fixture();
    const values = await Promise.all([
      f.connection().getAccessToken(),
      f.connection().getAccessToken(),
    ]);
    expect(values.map((v) => v.reveal())).toEqual([
      'synthetic-private-access',
      'synthetic-private-access',
    ]);
    expect(f.refresh).toHaveBeenCalledOnce();
    const stored = await repo().get();
    expect(
      decryptGmailRefreshToken(
        stored.encryptedAccessToken!.reveal(),
        key,
        users[0].id,
        users[0].email,
        'access',
      ).reveal(),
    ).toBe('synthetic-private-access');
    expect(await f.connection().client.get('profile')).toEqual({ ready: true });
    expect(f.refresh).toHaveBeenCalledOnce();
  });
  it('el repositorio impide cruzar propietarios y las actualizaciones con un snapshot ajeno', async () => {
    const foreign = createGmailCredentialRepository(
      service,
      users[0].id,
      users[1].accountId,
    );
    await expect(foreign.get()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      repo(0).requireReauth(await repo(1).get()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('la renovación rotada queda cifrada y un bloqueo caducado se puede recuperar', async () => {
    const f = fixture();
    f.refresh.mockResolvedValue({
      accessToken: new SecretValue('synthetic-new-access'),
      refreshToken: new SecretValue('synthetic-new-refresh'),
      scopes: gmailScopes,
      expiresInSeconds: 3600,
    });
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({
            token_lease_id: crypto.randomUUID(),
            token_lease_expires_at: new Date(Date.now() - 1000).toISOString(),
          })
          .eq('id', users[0].accountId)
      ).error,
    ).toBeNull();
    await f.connection().getAccessToken();
    const stored = await repo().get();
    expect(
      decryptGmailRefreshToken(
        stored.encryptedRefreshToken!.reveal(),
        key,
        users[0].id,
        users[0].email,
      ).reveal(),
    ).toBe('synthetic-new-refresh');
  });
  it('un invalid_grant exige reconectar sin repetir el error', async () => {
    const f = fixture();
    f.refresh.mockRejectedValue(new ProviderError('google', 'INVALID_GRANT'));
    await expect(f.connection().getAccessToken()).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    await expect(f.connection().getAccessToken()).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    expect(f.refresh).toHaveBeenCalledOnce();
    expect(await repo().get()).toMatchObject({
      status: 'REAUTH_REQUIRED',
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
    });
  });
  it('un resultado inválido anterior no desautoriza una conexión nueva', async () => {
    const f = fixture();
    f.refresh.mockImplementation(async () => {
      const r = await service
        .from('gmail_accounts')
        .update({
          credential_version: crypto.randomUUID(),
          encrypted_refresh_token: encrypt('synthetic-reconnected-refresh'),
          encrypted_access_token: encrypt(
            'synthetic-reconnected-access',
            users[0],
            'access',
          ),
          access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
          token_lease_id: null,
          token_lease_expires_at: null,
        })
        .eq('id', users[0].accountId);
      expect(r.error).toBeNull();
      throw new ProviderError('google', 'INVALID_GRANT');
    });
    expect((await f.connection().getAccessToken()).reveal()).toBe(
      'synthetic-reconnected-access',
    );
    expect((await repo().get()).status).toBe('CONNECTED');
  });
  it('desconectar durante una renovación no permite reactivar la cuenta', async () => {
    const f = fixture();
    f.refresh.mockImplementation(async () => {
      expect(await f.connection().disconnect()).toEqual({ revoked: true });
      return {
        accessToken: new SecretValue('synthetic-stale-access'),
        refreshToken: new SecretValue('synthetic-stale-refresh'),
        scopes: null,
        expiresInSeconds: 3600,
      };
    });
    await expect(f.connection().getAccessToken()).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
    });
    expect(await repo().get()).toMatchObject({
      status: 'DISCONNECTED',
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
    });
  });
  it('un fallo de Google al revocar no conserva tokens en la aplicación', async () => {
    const f = fixture();
    f.revoke.mockRejectedValue(new ProviderError('google', 'UNAVAILABLE'));
    expect(await f.connection().disconnect()).toEqual({ revoked: false });
    expect(await repo().get()).toMatchObject({
      status: 'DISCONNECTED',
      encryptedRefreshToken: null,
      encryptedAccessToken: null,
    });
  });
});
