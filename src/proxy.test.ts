import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createAuthClient } from '@/modules/auth/client';
import { isAuthConfigured } from '@/modules/auth/config';
import { proxy } from './proxy';

vi.mock('@/modules/auth/client', () => ({ createAuthClient: vi.fn() }));
vi.mock('@/modules/auth/config', () => ({ isAuthConfigured: vi.fn() }));

describe('renovación de cookies en Proxy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isAuthConfigured).mockReturnValue(true);
  });

  it('propaga la sesión renovada al render y al navegador conservando las cabeceras de privacidad', async () => {
    vi.mocked(createAuthClient).mockImplementation(
      (cookies) =>
        ({
          auth: {
            getUser: async () => {
              await cookies.setAll?.(
                [
                  {
                    name: 'session',
                    value: 'refreshed',
                    options: {
                      httpOnly: true,
                      secure: true,
                      sameSite: 'lax',
                      path: '/',
                    },
                  },
                ],
                {
                  'Cache-Control': 'private, no-store',
                  Expires: '0',
                  Pragma: 'no-cache',
                },
              );
            },
          },
        }) as unknown as ReturnType<typeof createAuthClient>,
    );
    const request = new NextRequest('https://app.example.com/app', {
      headers: { Cookie: 'session=expired' },
    });
    const response = await proxy(request);
    expect(request.cookies.get('session')?.value).toBe('refreshed');
    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      'session=refreshed',
    );
    expect(response.cookies.get('session')?.value).toBe('refreshed');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('expires')).toBe('0');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('permite mostrar el error de configuración sin construir un cliente inválido', async () => {
    vi.mocked(isAuthConfigured).mockReturnValue(false);
    const response = await proxy(
      new NextRequest('https://app.example.com/login'),
    );
    expect(response.status).toBe(200);
    expect(createAuthClient).not.toHaveBeenCalled();
  });
});
