import { NextResponse, type NextRequest } from 'next/server';
import { createServerAuthClient } from '@/app/_lib/auth';
import { getAuthConfig } from '@/modules/auth/config';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  let confirmed = false;
  try {
    const config = getAuthConfig();
    if (request.nextUrl.origin !== config.appOrigin) {
      return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 400 });
    }
    if (code && !request.nextUrl.searchParams.has('error')) {
      const client = await createServerAuthClient(true);
      const { error } = await client.auth.exchangeCodeForSession(code);
      confirmed = !error;
    }
    const response = NextResponse.redirect(
      new URL(
        confirmed ? '/app' : '/login?error=confirmation',
        config.appOrigin,
      ),
      303,
    );
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    return NextResponse.json(
      { error: 'AUTH_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
