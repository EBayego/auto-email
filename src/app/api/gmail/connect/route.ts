import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { getGmailOAuthService } from '@/app/_lib/gmail-oauth';
import { DataAccessError } from '@/db/errors';
import { GmailOAuthError } from '@/modules/gmail/errors';
import { PrivacyError } from '@/modules/privacy/notice';
import { gmailRequestOriginMatches } from '../origin';
import {
  gmailOAuthCookie,
  gmailOAuthLifetimeSeconds,
  gmailOnboardingCookie,
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
      !gmailRequestOriginMatches(request, config.appOrigin) ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return NextResponse.json(
        { error: 'INVALID_ORIGIN' },
        { status: 400, headers },
      );
    if (request.nextUrl.searchParams.get('authorized') !== '1')
      return NextResponse.redirect(
        new URL(
          `/privacy-consent${request.nextUrl.searchParams.get('onboarding') === '1' ? '?onboarding=1' : ''}`,
          config.appOrigin,
        ),
        { status: 303, headers },
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
    response.cookies.set(
      gmailOnboardingCookie,
      request.nextUrl.searchParams.get('onboarding') === '1' ? '1' : '',
      {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
        path: '/api/gmail',
        maxAge:
          request.nextUrl.searchParams.get('onboarding') === '1'
            ? gmailOAuthLifetimeSeconds
            : 0,
      },
    );
    return response;
  } catch (error) {
    if (error instanceof PrivacyError)
      return NextResponse.redirect(
        new URL(
          `/privacy-consent${request.nextUrl.searchParams.get('onboarding') === '1' ? '?onboarding=1' : ''}`,
          getAuthConfig().appOrigin,
        ),
        { status: 303, headers },
      );
    if (error instanceof GmailOAuthError) {
      const response = NextResponse.redirect(
        new URL(
          `${request.nextUrl.searchParams.get('onboarding') === '1' ? '/onboarding' : '/app'}?gmail=${error.code}`,
          getAuthConfig().appOrigin,
        ),
        303,
      );
      for (const [name, value] of Object.entries(headers))
        response.headers.set(name, value);
      return response;
    }
    const code = error instanceof DataAccessError ? error.code : 'UNAVAILABLE';
    const status =
      code === 'UNAUTHENTICATED' ? 401 : code === 'FORBIDDEN' ? 403 : 503;
    if (
      request.nextUrl.searchParams.get('onboarding') === '1' &&
      status === 503
    ) {
      return NextResponse.redirect(
        new URL('/onboarding?gmail=UNAVAILABLE', getAuthConfig().appOrigin),
        { status: 303, headers },
      );
    }
    return NextResponse.json({ error: code }, { status, headers });
  }
}
