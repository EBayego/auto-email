import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { getGmailConnection } from '@/app/_lib/gmail-connection';
import { DataAccessError } from '@/db/errors';
import { GmailCredentialError } from '@/modules/gmail/credentials';
import { PrivacyError } from '@/modules/privacy/notice';
import { gmailRequestOriginMatches } from './origin';

export async function manageGmail(
  request: NextRequest,
  operation: 'check' | 'disconnect',
) {
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
  };
  try {
    const config = getAuthConfig();
    if (
      !gmailRequestOriginMatches(request, config.appOrigin) ||
      request.headers.get('origin') !== config.appOrigin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return NextResponse.json(
        { error: 'INVALID_ORIGIN' },
        { status: 400, headers },
      );
    let result = 'CHECKED';
    if (operation === 'disconnect') {
      if (
        request.headers.get('content-type')?.split(';')[0] !==
          'application/x-www-form-urlencoded' ||
        Number(request.headers.get('content-length')) > 256
      )
        return NextResponse.json(
          { error: 'INVALID_INPUT' },
          { status: 400, headers },
        );
      const body = await request.text();
      const form = new URLSearchParams(body);
      if (
        Buffer.byteLength(body) > 256 ||
        form.get('confirmed') !== 'true' ||
        [...form.keys()].length !== 1
      )
        return NextResponse.json(
          { error: 'INVALID_INPUT' },
          { status: 400, headers },
        );
    }
    try {
      const connection = await getGmailConnection();
      if (operation === 'disconnect')
        result = (await connection.disconnect()).revoked
          ? 'DISCONNECTED'
          : 'REVOCATION_FAILED';
      else await connection.client.get('profile');
    } catch (error) {
      if (error instanceof PrivacyError)
        return NextResponse.redirect(
          new URL('/privacy-consent', config.appOrigin),
          { status: 303, headers },
        );
      if (
        error instanceof DataAccessError &&
        ['UNAUTHENTICATED', 'FORBIDDEN'].includes(error.code)
      )
        return NextResponse.json(
          { error: error.code },
          { status: error.code === 'UNAUTHENTICATED' ? 401 : 403, headers },
        );
      result =
        error instanceof DataAccessError && error.code === 'NOT_FOUND'
          ? 'NOT_CONNECTED'
          : error instanceof GmailCredentialError
            ? error.code
            : 'UNAVAILABLE';
    }
    const response = NextResponse.redirect(
      new URL(`/app?gmail=${result}`, config.appOrigin),
      303,
    );
    for (const [name, value] of Object.entries(headers))
      response.headers.set(name, value);
    return response;
  } catch {
    return NextResponse.json(
      { error: 'UNAVAILABLE' },
      { status: 503, headers },
    );
  }
}
