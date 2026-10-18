import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import { createGoogleAuthorizationClient } from '@/providers/google';
import { ProviderError } from '@/providers/errors';
import { withMessageQueries } from '@/providers/gmail-messages';
import type { ProviderClients } from '@/providers/contracts';
import {
  createGmailOAuthService,
  hashOAuthState,
  type GmailOAuthStore,
} from './oauth';
import { decryptGmailRefreshToken } from './tokens';

const userId = '00000000-0000-4000-8000-000000000012';
const key = new SecretValue(Buffer.alloc(32, 9).toString('base64'));
function fixture() {
  let pending:
    { stateHash: string; codeVerifier: string; expiresAt: string } | undefined;
  const store = {
    beginAttempt: vi.fn<GmailOAuthStore['beginAttempt']>(async (value) => {
      pending = value;
    }),
    consumeAttempt: vi.fn<GmailOAuthStore['consumeAttempt']>(async (hash) => {
      if (
        !pending ||
        pending.stateHash !== hash ||
        Date.parse(pending.expiresAt) <= Date.now()
      )
        return null;
      const verifier = pending.codeVerifier;
      pending = undefined;
      return verifier;
    }),
    connectAccount: vi.fn<GmailOAuthStore['connectAccount']>(async () => {}),
  };
  const tokens = {
    accessToken: new SecretValue('private-access-token'),
    refreshToken: new SecretValue(
      'private-refresh-token',
    ) as SecretValue | null,
    scopes: [...gmailScopes],
    expiresInSeconds: 3600,
  };
  const exchangeCode = vi.fn(async () => tokens);
  const get = vi.fn(async (): Promise<unknown> => ({
    emailAddress: 'Mailbox@Example.invalid',
  }));
  const authorization = createGoogleAuthorizationClient({
    clientId: 'unit.apps.googleusercontent.com',
    clientSecret: new SecretValue('private-client-secret'),
    redirectUri: 'http://localhost:3000/api/gmail/callback',
  });
  const providers = {
    googleAuthorization: { ...authorization, exchangeCode },
    gmail: vi.fn<ProviderClients['gmail']>(() =>
      withMessageQueries({
        get,
        createDraft: vi.fn(),
      }),
    ),
  };
  const service = createGmailOAuthService({
    userId,
    encryptionKey: key,
    store,
    providers,
  });
  return { service, store, providers, exchangeCode, get, tokens };
}

describe('flujo OAuth de Gmail', () => {
  it('crea un estado aleatorio y un desafío PKCE S256 con verificador solo en el servidor', async () => {
    const { service, store } = fixture();
    const first = await service.begin();
    const second = await service.begin();
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.state).not.toBe(first.state);
    const pending = store.beginAttempt.mock.calls[0][0];
    const url = new URL(first.url);
    expect(pending.stateHash).toBe(hashOAuthState(first.state));
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(pending.codeVerifier).digest('base64url'),
    );
    expect(url.searchParams.get('state')).toBe(first.state);
    expect(first.url).not.toContain(pending.codeVerifier);
    expect(Date.parse(pending.expiresAt) - Date.now()).toBeGreaterThan(590000);
  });

  it('obtiene la identidad desde Gmail y guarda únicamente el refresh token cifrado para el usuario autenticado', async () => {
    const { service, store, providers, exchangeCode, get } = fixture();
    const { state } = await service.begin();
    const params = new URLSearchParams({
      state,
      code: 'private-code',
      userId: 'attacker',
      email: 'attacker@example.invalid',
    });
    await service.complete(params, state);
    expect(exchangeCode).toHaveBeenCalledWith({
      code: 'private-code',
      codeVerifier: store.beginAttempt.mock.calls[0][0].codeVerifier,
    });
    expect(get).toHaveBeenCalledWith('profile');
    expect(await providers.gmail.mock.calls[0][0]()).toBe(
      'private-access-token',
    );
    const saved = store.connectAccount.mock.calls[0][0];
    expect(saved.email).toBe('mailbox@example.invalid');
    expect(
      decryptGmailRefreshToken(
        saved.encryptedRefreshToken,
        key,
        userId,
        saved.email,
      ).reveal(),
    ).toBe('private-refresh-token');
    expect(JSON.stringify(saved)).not.toContain('private-refresh-token');
    expect(JSON.stringify(saved)).not.toContain('private-access-token');
    await expect(service.complete(params, state)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(store.connectAccount).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', 'x'.repeat(43), 'bad-state'])(
    'rechaza estado/cookie incorrecto sin canjear códigos (%s)',
    async (cookie) => {
      const { service, store, exchangeCode } = fixture();
      const { state } = await service.begin();
      await expect(
        service.complete(new URLSearchParams({ state, code: 'code' }), cookie),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
      expect(store.consumeAttempt).not.toHaveBeenCalled();
      expect(exchangeCode).not.toHaveBeenCalled();
    },
  );

  it('un nuevo intento invalida el anterior y un intento caduca a los diez minutos', async () => {
    const { service, exchangeCode } = fixture();
    const old = await service.begin();
    const current = await service.begin();
    await expect(
      service.complete(
        new URLSearchParams({ state: old.state, code: 'code' }),
        old.state,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000);
    await expect(
      service.complete(
        new URLSearchParams({ state: current.state, code: 'code' }),
        current.state,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it.each(['state', 'code', 'error'])(
    'rechaza parámetros %s duplicados',
    async (parameter) => {
      const { service, exchangeCode } = fixture();
      const { state } = await service.begin();
      const params = new URLSearchParams({ state, code: 'code' });
      params.append(parameter, 'one');
      params.append(parameter, 'two');
      await expect(service.complete(params, state)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
      expect(exchangeCode).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['access_denied', 'CANCELLED'],
    ['other-provider-detail', 'AUTHORIZATION_FAILED'],
  ])('gestiona el rechazo %s y consume el intento', async (error, expected) => {
    const { service, exchangeCode } = fixture();
    const { state } = await service.begin();
    const params = new URLSearchParams({ state, error });
    await expect(service.complete(params, state)).rejects.toMatchObject({
      code: expected,
    });
    await expect(service.complete(params, state)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it.each([[gmailScopes.slice(0, 1)], [gmailScopes.slice(1)], [[]]])(
    'no conecta con permisos parciales',
    async (scopes) => {
      const { service, store, tokens, get } = fixture();
      tokens.scopes = [...scopes];
      const { state } = await service.begin();
      await expect(
        service.complete(new URLSearchParams({ state, code: 'code' }), state),
      ).rejects.toMatchObject({ code: 'MISSING_SCOPES' });
      expect(store.connectAccount).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('no marca CONNECTED sin refresh token ni altera una conexión previa', async () => {
    const { service, store, tokens } = fixture();
    tokens.refreshToken = null;
    const { state } = await service.begin();
    await expect(
      service.complete(new URLSearchParams({ state, code: 'code' }), state),
    ).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REQUIRED' });
    expect(store.connectAccount).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { emailAddress: 'bad' },
    { emailAddress: ' a@example.invalid' },
  ])('rechaza perfiles Gmail inválidos', async (profile) => {
    const { service, store, get } = fixture();
    get.mockResolvedValue(profile);
    const { state } = await service.begin();
    await expect(
      service.complete(new URLSearchParams({ state, code: 'code' }), state),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect(store.connectAccount).not.toHaveBeenCalled();
  });

  it('no reintenta intercambios fallidos ni reutiliza el intento', async () => {
    const { service, store, exchangeCode } = fixture();
    exchangeCode.mockRejectedValue(new ProviderError('google', 'UNAVAILABLE'));
    const { state } = await service.begin();
    const params = new URLSearchParams({ state, code: 'code' });
    await expect(service.complete(params, state)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(service.complete(params, state)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(store.connectAccount).not.toHaveBeenCalled();
  });
});
