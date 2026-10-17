import { NextResponse } from 'next/server';
import { getAccount } from '@/app/_lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await getAccount();
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

  if (result.status !== 'authenticated') {
    const failures = {
      unauthenticated: { status: 401, error: 'UNAUTHENTICATED' },
      forbidden: { status: 403, error: 'FORBIDDEN' },
      unavailable: { status: 503, error: 'AUTH_UNAVAILABLE' },
    } as const;
    const failure = failures[result.status];
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status, headers },
    );
  }

  return NextResponse.json(result.account, { headers });
}
