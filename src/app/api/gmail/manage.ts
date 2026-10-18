import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { getGmailConnection } from '@/app/_lib/gmail-connection';
import { DataAccessError } from '@/db/errors';
import { GmailCredentialError } from '@/modules/gmail/credentials';

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
      request.nextUrl.origin !== config.appOrigin ||
      request.headers.get('origin') !== config.appOrigin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return NextResponse.json(
        { error: 'INVALID_ORIGIN' },
        { status: 400, headers },
      );
    let result = 'CHECKED';
    try {
      const connection = await getGmailConnection();
      if (operation === 'disconnect')
        result = (await connection.disconnect()).revoked
          ? 'DISCONNECTED'
          : 'REVOCATION_FAILED';
      else await connection.client.get('profile');
    } catch (error) {
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
