import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { getExecutionControls } from '@/app/_lib/execution-controls';
import { DataAccessError } from '@/db/errors';
import { parseExecutionForm } from '@/modules/workflow/execution-controls';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
  };
  try {
    const { appOrigin } = getAuthConfig();
    if (
      request.headers.get('origin') !== appOrigin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return NextResponse.json(
        { error: 'INVALID_ORIGIN' },
        { status: 400, headers },
      );
    if (
      request.headers.get('content-type')?.split(';')[0] !==
      'application/x-www-form-urlencoded'
    )
      throw new DataAccessError('INVALID_INPUT');
    if (Number(request.headers.get('content-length')) > 2048)
      throw new DataAccessError('INVALID_INPUT');
    const body = await request.text();
    if (Buffer.byteLength(body) > 2048)
      throw new DataAccessError('INVALID_INPUT');
    const operation = parseExecutionForm(new URLSearchParams(body));
    const controls = await getExecutionControls();
    if (operation.action === 'settings')
      await controls.settings(operation.settings);
    else await controls.account(operation.action);
    return NextResponse.redirect(
      new URL(
        `/app?execution=${operation.action === 'run' ? 'QUEUED' : 'SAVED'}`,
        appOrigin,
      ),
      { status: 303, headers },
    );
  } catch (error) {
    const code = error instanceof DataAccessError ? error.code : 'UNAVAILABLE';
    return NextResponse.json(
      { error: code },
      {
        status: {
          UNAUTHENTICATED: 401,
          FORBIDDEN: 403,
          NOT_FOUND: 404,
          INVALID_INPUT: 400,
          UNAVAILABLE: 503,
        }[code],
        headers,
      },
    );
  }
}
