import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { getSharePointContext } from '@/app/_lib/sharepoint';
import { microsoftOAuthCookie } from '@/modules/sharepoint/auth';
import { microsoftOAuthErrorCode } from '@/modules/sharepoint/oauth-errors';
import { logOperationalEvent } from '@/modules/security/operational-log';
import { privateHeaders } from '@/app/api/knowledge/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let result = 'CONNECTED';
  try {
    await (
      await getSharePointContext()
    ).auth.complete(
      request.nextUrl.searchParams,
      request.cookies.get(microsoftOAuthCookie)?.value,
    );
  } catch (error) {
    result = microsoftOAuthErrorCode(error);
    logOperationalEvent({
      type: 'MICROSOFT_CONNECTION_FAILED',
      reasonCode: result,
    });
  }
  const response = NextResponse.redirect(
    new URL(
      `/knowledge?microsoft=${encodeURIComponent(result)}`,
      getAuthConfig().appOrigin,
    ),
    { status: 303, headers: privateHeaders },
  );
  response.cookies.set(microsoftOAuthCookie, '', {
    httpOnly: true,
    secure: getAuthConfig().secureCookies,
    sameSite: 'lax',
    path: '/api/connectors/microsoft',
    maxAge: 0,
  });
  return response;
}
