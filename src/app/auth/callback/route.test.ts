import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createServerAuthClient } from '@/app/_lib/auth';
import { GET } from './route';

vi.mock('@/app/_lib/auth', () => ({ createServerAuthClient: vi.fn() }));
vi.mock('@/modules/auth/config', () => ({
  getAuthConfig: () => ({ appOrigin: 'https://app.example.com' }),
}));
const exchangeCodeForSession = vi.fn();

describe('callback PKCE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServerAuthClient).mockResolvedValue({
      auth: { exchangeCodeForSession },
    } as unknown as Awaited<ReturnType<typeof createServerAuthClient>>);
  });

  it('intercambia el código con el verificador de las cookies y descarta redirecciones externas', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(
      new NextRequest(
        'https://app.example.com/auth/callback?code=valid&next=https://attacker.example.com',
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://app.example.com/app',
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('valid');
  });

  it('rechaza un código sin verificador, reutilizado o caducado', async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { message: 'provider detail' },
    });
    const response = await GET(
      new NextRequest('https://app.example.com/auth/callback?code=invalid'),
    );
    expect(response.headers.get('location')).toBe(
      'https://app.example.com/login?error=confirmation',
    );
  });

  it.each(['', '?error=access_denied', '?code=valid&error=access_denied'])(
    'rechaza callbacks incompletos o denegados (%s)',
    async (query) => {
      const response = await GET(
        new NextRequest(`https://app.example.com/auth/callback${query}`),
      );
      expect(response.headers.get('location')).toContain(
        '/login?error=confirmation',
      );
      expect(exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );

  it('rechaza un origen manipulado antes de intercambiar códigos', async () => {
    const response = await GET(
      new NextRequest('https://attacker.example.com/auth/callback?code=valid'),
    );
    expect(response.status).toBe(400);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
