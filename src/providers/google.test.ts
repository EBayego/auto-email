import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import { createGoogleAuthorizationClient } from './google';

const config = {
  clientId: 'unit.apps.googleusercontent.com',
  clientSecret: new SecretValue('private-client-secret'),
  redirectUri: 'http://localhost:3000/api/gmail/callback',
};
const input = { code: 'private-code', codeVerifier: 'v'.repeat(43) };
const payload = {
  access_token: 'private-access-token',
  refresh_token: 'private-refresh-token',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: gmailScopes.join(' '),
};

describe('intercambio del código OAuth Google', () => {
  it('envía PKCE y las credenciales exclusivamente al endpoint de Google y redacta tokens', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(payload));
    const tokens = await createGoogleAuthorizationClient(
      config,
      10000,
      fetcher,
    ).exchangeCode(input);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(options).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
    });
    const body = new URLSearchParams(String(options?.body));
    expect(body.get('code_verifier')).toBe(input.codeVerifier);
    expect(body.get('redirect_uri')).toBe(config.redirectUri);
    expect(body.get('client_secret')).toBe(config.clientSecret.reveal());
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(tokens.accessToken.reveal()).toBe(payload.access_token);
    expect(tokens.refreshToken?.reveal()).toBe(payload.refresh_token);
    for (const value of [payload.access_token, payload.refresh_token])
      expect(JSON.stringify(tokens) + inspect(tokens)).not.toContain(value);
  });

  it.each([400, 401, 429, 500])(
    'oculta cuerpos y no reintenta un error %s',
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: 'invalid_grant',
            error_description: 'private-code private-client-secret',
          },
          { status },
        ),
      );
      const client = createGoogleAuthorizationClient(config, 10000, fetcher);
      await expect(client.exchangeCode(input)).rejects.toThrow(/^google:/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    {},
    { ...payload, token_type: 'other' },
    { ...payload, access_token: '' },
    { ...payload, refresh_token: '' },
    { ...payload, scope: undefined },
    { ...payload, expires_in: '3600' },
  ])('rechaza respuestas malformadas', async (value) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(value));
    await expect(
      createGoogleAuthorizationClient(config, 10000, fetcher).exchangeCode(
        input,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('no inventa refresh tokens ausentes ni scopes no concedidos', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...payload,
        refresh_token: undefined,
        scope: gmailScopes[0],
      }),
    );
    const tokens = await createGoogleAuthorizationClient(
      config,
      10000,
      fetcher,
    ).exchangeCode(input);
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.scopes).toEqual([gmailScopes[0]]);
  });

  it('rechaza códigos y verificadores inválidos antes de acceder a la red', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createGoogleAuthorizationClient(config, 10000, fetcher);
    await expect(
      client.exchangeCode({ ...input, code: '' }),
    ).rejects.toMatchObject({ code: 'REQUEST_REJECTED' });
    await expect(
      client.exchangeCode({ ...input, codeVerifier: 'short' }),
    ).rejects.toMatchObject({ code: 'REQUEST_REJECTED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('renueva por POST sin incluir tokens en URL y admite rotación o scopes omitidos', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...payload, scope: undefined }));
    const token = new SecretValue('private-existing-refresh');
    const tokens = await createGoogleAuthorizationClient(
      config,
      10000,
      fetcher,
    ).refreshAccessToken(token);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(String(options?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe(token.reveal());
    expect(body.get('client_secret')).toBe(config.clientSecret.reveal());
    expect(tokens.refreshToken?.reveal()).toBe(payload.refresh_token);
    expect(tokens.scopes).toBeNull();
    expect(tokens.expiresInSeconds).toBe(3600);
    expect(JSON.stringify(tokens) + inspect(tokens)).not.toContain(
      payload.refresh_token,
    );
  });

  it('distingue invalid_grant de errores operativos sin incluir el cuerpo privado', async () => {
    for (const [status, error, expected] of [
      [400, 'invalid_grant', 'INVALID_GRANT'],
      [400, 'invalid_client', 'REQUEST_REJECTED'],
      [429, 'invalid_grant', 'RATE_LIMITED'],
      [500, 'invalid_grant', 'UNAVAILABLE'],
    ] as const) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error, error_description: 'private-refresh-token' },
            { status },
          ),
        );
      try {
        await createGoogleAuthorizationClient(
          config,
          10000,
          fetcher,
        ).refreshAccessToken(new SecretValue('private-refresh-token'));
        expect.fail('Debe fallar');
      } catch (value) {
        expect(value).toMatchObject({ code: expected });
        expect(String(value)).not.toContain('private-refresh-token');
      }
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it.each([
    null,
    {},
    { ...payload, access_token: '' },
    { ...payload, refresh_token: '' },
    { ...payload, expires_in: 0 },
    { ...payload, expires_in: 86401 },
    { ...payload, scope: [] },
  ])('rechaza una renovación malformada', async (value) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(value));
    await expect(
      createGoogleAuthorizationClient(
        config,
        10000,
        fetcher,
      ).refreshAccessToken(new SecretValue('private-refresh')),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([200, 400])(
    'la revocación es idempotente y mantiene el token fuera de URL y logs (%s)',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          status === 200
            ? new Response(null, { status })
            : Response.json({ error: 'invalid_token' }, { status }),
        );
      await createGoogleAuthorizationClient(config, 10000, fetcher).revokeToken(
        new SecretValue('private-revoke-token'),
      );
      const [url, options] = fetcher.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/revoke');
      expect(options).toMatchObject({
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
      });
      expect(new URLSearchParams(String(options?.body)).get('token')).toBe(
        'private-revoke-token',
      );
    },
  );

  it('un fallo de revocación no produce éxito implícito ni reintentos', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: 'private-token' }, { status: 503 }),
      );
    await expect(
      createGoogleAuthorizationClient(config, 10000, fetcher).revokeToken(
        new SecretValue('private-revoke-token'),
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
