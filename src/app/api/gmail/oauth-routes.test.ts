import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getGmailOAuthService } from '@/app/_lib/gmail-oauth';
import { DataAccessError } from '@/db/errors';
import { GmailOAuthError } from '@/modules/gmail/errors';
import { gmailOAuthCookie } from '@/modules/gmail/oauth';
import { GET as connect } from './connect/route';
import { GET as callback } from './callback/route';

vi.mock('@/app/_lib/gmail-oauth', () => ({ getGmailOAuthService: vi.fn() }));
const state = 's'.repeat(43);
const begin = vi.fn(async () => ({
  state,
  url: 'https://accounts.google.com/o/oauth2/v2/auth?state=' + state,
}));
const complete = vi.fn<
  Awaited<ReturnType<typeof getGmailOAuthService>>['complete']
>(async () => {});
const origin = 'https://app.example.com';

describe('endpoints OAuth Gmail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('APP_URL', origin);
    begin.mockResolvedValue({
      state,
      url: 'https://accounts.google.com/o/oauth2/v2/auth?state=' + state,
    });
    complete.mockResolvedValue();
    vi.mocked(getGmailOAuthService).mockResolvedValue({ begin, complete });
  });

  it('redirige a Google y establece una cookie HttpOnly, Secure y SameSite=Lax con plazo limitado', async () => {
    const response = await connect(
      new NextRequest(
        `${origin}/api/gmail/connect?userId=attacker&next=https://attacker.example`,
      ),
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).origin).toBe(
      'https://accounts.google.com',
    );
    expect(response.cookies.get(gmailOAuthCookie)).toMatchObject({
      value: state,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/gmail',
      maxAge: 600,
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('rechaza %s antes de iniciar OAuth', async (code, status) => {
    vi.mocked(getGmailOAuthService).mockRejectedValue(
      new DataAccessError(code),
    );
    const response = await connect(
      new NextRequest(`${origin}/api/gmail/connect`),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
    expect(begin).not.toHaveBeenCalled();
  });

  it('rechaza otro origen y la iniciación desde otra web antes de acceder a la sesión', async () => {
    expect(
      (
        await connect(
          new NextRequest('https://attacker.example/api/gmail/connect'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await connect(
          new NextRequest(`${origin}/api/gmail/connect`, {
            headers: { 'sec-fetch-site': 'cross-site' },
          }),
        )
      ).status,
    ).toBe(400);
    expect(vi.mocked(getGmailOAuthService)).not.toHaveBeenCalled();
  });

  it('admite el retorno desde Google, elimina la cookie y redirige sin código ni tokens', async () => {
    const response = await callback(
      new NextRequest(
        `${origin}/api/gmail/callback?state=${state}&code=private-code&next=https://attacker.example`,
        {
          headers: {
            cookie: `${gmailOAuthCookie}=${state}`,
            'sec-fetch-site': 'cross-site',
          },
        },
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${origin}/app?gmail=CONNECTED`,
    );
    expect(complete.mock.calls[0][1]).toBe(state);
    expect(response.cookies.get(gmailOAuthCookie)).toMatchObject({
      maxAge: 0,
      value: '',
      secure: true,
      httpOnly: true,
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect([...response.headers].join()).not.toContain('private-code');
  });

  it.each([
    'CANCELLED',
    'INVALID_STATE',
    'MISSING_SCOPES',
    'REFRESH_TOKEN_REQUIRED',
    'ACCOUNT_IN_USE',
    'ACCOUNT_MISMATCH',
  ] as const)(
    'presenta el error controlado %s y limpia el intento del navegador',
    async (code) => {
      complete.mockRejectedValue(new GmailOAuthError(code));
      const response = await callback(
        new NextRequest(`${origin}/api/gmail/callback?code=private`),
      );
      expect(response.headers.get('location')).toBe(
        `${origin}/app?gmail=${code}`,
      );
      expect(response.cookies.get(gmailOAuthCookie)?.maxAge).toBe(0);
    },
  );

  it('solicita iniciar sesión si el usuario salió de la aplicación antes del retorno', async () => {
    vi.mocked(getGmailOAuthService).mockRejectedValue(
      new DataAccessError('UNAUTHENTICATED'),
    );
    const response = await callback(
      new NextRequest(`${origin}/api/gmail/callback?code=private`),
    );
    expect(response.headers.get('location')).toBe(
      `${origin}/login?error=gmail_session`,
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('oculta errores internos del proveedor y no refleja parámetros en redirecciones', async () => {
    complete.mockRejectedValue(
      new Error('private-token private-email@example.invalid'),
    );
    const response = await callback(
      new NextRequest(
        `${origin}/api/gmail/callback?error_description=private&next=https://attacker.example`,
      ),
    );
    expect(response.headers.get('location')).toBe(
      `${origin}/app?gmail=UNAVAILABLE`,
    );
    expect(await response.text()).not.toContain('private-token');
  });

  it('rechaza un host de callback manipulado', async () => {
    expect(
      (
        await callback(
          new NextRequest('https://attacker.example/api/gmail/callback'),
        )
      ).status,
    ).toBe(400);
    expect(vi.mocked(getGmailOAuthService)).not.toHaveBeenCalled();
  });
  it('una desconexión pendiente muestra instrucciones antes de volver a iniciar OAuth', async () => {
    begin.mockRejectedValue(new GmailOAuthError('DISCONNECT_PENDING'));
    const response = await connect(
      new NextRequest(`${origin}/api/gmail/connect`),
    );
    expect(response.headers.get('location')).toBe(
      `${origin}/app?gmail=DISCONNECT_PENDING`,
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
