import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getGmailConnection } from '@/app/_lib/gmail-connection';
import { GmailCredentialError } from '@/modules/gmail/credentials';
import { DataAccessError } from '@/db/errors';
import { withMessageQueries } from '@/providers/gmail-messages';
import { POST as disconnect } from './disconnect/route';
import { POST as check } from './check/route';

vi.mock('@/app/_lib/gmail-connection', () => ({ getGmailConnection: vi.fn() }));
const origin = 'https://app.example.com';
const get = vi.fn();
const stop = vi.fn();
const request = (
  path: string,
  options: ConstructorParameters<typeof NextRequest>[1] = {},
) =>
  new NextRequest(origin + path, {
    method: 'POST',
    headers: { origin },
    ...options,
  });
describe('gestión de la conexión Gmail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('APP_URL', origin);
    get.mockResolvedValue({
      emailAddress: 'private@example.invalid',
      access_token: 'private-access-token',
    });
    stop.mockResolvedValue({ revoked: true });
    vi.mocked(getGmailConnection).mockResolvedValue({
      client: withMessageQueries({ get, createDraft: vi.fn() }),
      getAccessToken: vi.fn(),
      disconnect: stop,
    });
  });
  it('solo informa del estado de la comprobación, sin devolver tokens ni el perfil', async () => {
    const response = await check(request('/api/gmail/check?userId=attacker'));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      origin + '/app?gmail=CHECKED',
    );
    expect(get).toHaveBeenCalledWith('profile');
    expect(
      [...response.headers].join() + (await response.text()),
    ).not.toContain('private-access-token');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([true, false])(
    'distingue desconexión y fallo al revocar (revoked=%s)',
    async (revoked) => {
      stop.mockResolvedValue({ revoked });
      const response = await disconnect(request('/api/gmail/disconnect'));
      expect(response.headers.get('location')).toBe(
        origin + `/app?gmail=${revoked ? 'DISCONNECTED' : 'REVOCATION_FAILED'}`,
      );
      expect(stop).toHaveBeenCalledOnce();
      expect(get).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { origin: 'https://attacker.example' },
    { origin, 'sec-fetch-site': 'cross-site' },
  ] as Record<string, string>[])(
    'rechaza peticiones sin protección de origen antes de tocar credenciales',
    async (headers) => {
      const response = await disconnect(
        request('/api/gmail/disconnect', { headers }),
      );
      expect(response.status).toBe(400);
      expect(getGmailConnection).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
  ] as const)('rechaza %s', async (code, status) => {
    vi.mocked(getGmailConnection).mockRejectedValue(new DataAccessError(code));
    expect((await disconnect(request('/api/gmail/disconnect'))).status).toBe(
      status,
    );
    expect(stop).not.toHaveBeenCalled();
  });
  it.each(['REAUTH_REQUIRED', 'NOT_CONNECTED', 'TOKEN_BUSY'] as const)(
    'presenta instrucciones seguras para %s',
    async (code) => {
      get.mockRejectedValue(new GmailCredentialError(code));
      expect(
        (await check(request('/api/gmail/check'))).headers.get('location'),
      ).toBe(origin + `/app?gmail=${code}`);
    },
  );
  it('oculta los errores internos', async () => {
    get.mockRejectedValue(new Error('private-token'));
    expect(
      (await check(request('/api/gmail/check'))).headers.get('location'),
    ).toBe(origin + '/app?gmail=UNAVAILABLE');
  });
});
