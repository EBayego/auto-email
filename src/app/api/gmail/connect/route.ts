import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { getGmailOAuthService } from '@/app/_lib/gmail-oauth';
import { DataAccessError } from '@/db/errors';
import { GmailOAuthError } from '@/modules/gmail/errors';
import {
  gmailOAuthCookie,
  gmailOAuthLifetimeSeconds,
} from '@/modules/gmail/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    if (
      request.nextUrl.origin !== config.appOrigin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return NextResponse.json(
        { error: 'INVALID_ORIGIN' },
        { status: 400, headers },
      );
    const service = await getGmailOAuthService();
    const { state, url } = await service.begin();
    const response = NextResponse.redirect(url, 303);
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    response.cookies.set(gmailOAuthCookie, state, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      path: '/api/gmail',
      maxAge: gmailOAuthLifetimeSeconds,
    });
    return response;
  } catch (error) {
    if (error instanceof GmailOAuthError) {
      const response = NextResponse.redirect(
        new URL(`/app?gmail=${error.code}`, getAuthConfig().appOrigin),
        303,
      );
      for (const [name, value] of Object.entries(headers))
        response.headers.set(name, value);
      return response;
    }
    const code = error instanceof DataAccessError ? error.code : 'UNAVAILABLE';
    const status =
      code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : 503;
    return NextResponse.json({ error: code }, { status, headers });
  }
}
