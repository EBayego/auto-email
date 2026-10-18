import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { getGmailOAuthService } from '@/app/_lib/gmail-oauth';
import { DataAccessError } from '@/db/errors';
import { GmailOAuthError } from '@/modules/gmail/errors';
import { gmailOAuthCookie } from '@/modules/gmail/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};

export async function GET(request: NextRequest) {
  try {
    const config = getAuthConfig();
    if (request.nextUrl.origin !== config.appOrigin)
      return NextResponse.json(
        { error: 'INVALID_ORIGIN' },
        { status: 400, headers },
      );
    let result = 'CONNECTED';
    let requiresLogin = false;
    try {
      const service = await getGmailOAuthService();
      await service.complete(
        request.nextUrl.searchParams,
        request.cookies.get(gmailOAuthCookie)?.value,
      );
    } catch (error) {
      requiresLogin =
        error instanceof DataAccessError && error.code === 'UNAUTHENTICATED';
      result = error instanceof GmailOAuthError ? error.code : 'UNAVAILABLE';
    }
    const response = NextResponse.redirect(
      new URL(
        requiresLogin ? '/login?error=gmail_session' : `/app?gmail=${result}`,
        config.appOrigin,
      ),
      303,
    );
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    response.cookies.set(gmailOAuthCookie, '', {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      path: '/api/gmail',
      maxAge: 0,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: 'UNAVAILABLE' },
      { status: 503, headers },
    );
  }
}
