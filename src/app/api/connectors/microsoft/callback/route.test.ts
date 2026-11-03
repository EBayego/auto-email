import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError, ServerError } from '@azure/msal-node';
import { GET } from './route';
import { getSharePointContext } from '@/app/_lib/sharepoint';
import { logOperationalEvent } from '@/modules/security/operational-log';
import { microsoftOAuthCookie } from '@/modules/sharepoint/auth';

vi.mock('@/app/_lib/sharepoint', () => ({ getSharePointContext: vi.fn() }));
vi.mock('@/modules/security/operational-log', () => ({
  logOperationalEvent: vi.fn(),
}));
const complete = vi.fn();
const request = () =>
  new NextRequest(
    'http://localhost:3000/api/connectors/microsoft/callback?state=private-state&code=private-code',
    {
      headers: { cookie: `${microsoftOAuthCookie}=private-cookie` },
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  complete.mockResolvedValue({ id: 'fixture' });
  vi.mocked(getSharePointContext).mockResolvedValue({
    auth: { complete },
  } as unknown as Awaited<ReturnType<typeof getSharePointContext>>);
});

describe('retorno privado de Microsoft', () => {
  it('vuelve a conocimiento y elimina la cookie tras guardar una conexión', async () => {
    const response = await GET(request());
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/knowledge?microsoft=CONNECTED',
    );
    expect(response.cookies.get(microsoftOAuthCookie)?.maxAge).toBe(0);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(logOperationalEvent).not.toHaveBeenCalled();
  });
  it.each([
    [
      new AuthError('nonce_mismatch', '', 'private-token'),
      'MICROSOFT_IDENTITY_REJECTED',
    ],
    [
      new ServerError('invalid_client', '', 'private-secret', '', '7000215'),
      'MICROSOFT_CLIENT_SECRET_INVALID',
    ],
    [new Error('private-provider-response'), 'MICROSOFT_UNAVAILABLE'],
  ])(
    'redirige con un diagnóstico seguro y lo registra sin credenciales',
    async (error, code) => {
      complete.mockRejectedValue(error);
      const response = await GET(request());
      expect(response.headers.get('location')).toBe(
        `http://localhost:3000/knowledge?microsoft=${code}`,
      );
      expect(response.cookies.get(microsoftOAuthCookie)?.maxAge).toBe(0);
      expect(logOperationalEvent).toHaveBeenCalledWith({
        type: 'MICROSOFT_CONNECTION_FAILED',
        reasonCode: code,
      });
      expect(
        JSON.stringify(vi.mocked(logOperationalEvent).mock.calls),
      ).not.toContain('private-');
    },
  );
});
