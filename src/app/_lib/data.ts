import 'server-only';
import { cache } from 'react';
import { NextResponse } from 'next/server';
import { DataAccessError } from '@/db/errors';
import { openUserDataAccess } from '@/db/user-data';
import { createServerAuthClient } from './auth';

export const getUserData = cache(async () =>
  openUserDataAccess(await createServerAuthClient()),
);

export async function userDataResponse<T>(
  operation: (data: Awaited<ReturnType<typeof getUserData>>) => Promise<T>,
) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  try {
    const data = await getUserData();
    return NextResponse.json(await operation(data), { headers });
  } catch (error) {
    const code = error instanceof DataAccessError ? error.code : 'UNAVAILABLE';
    const statuses = {
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      INVALID_INPUT: 400,
      UNAVAILABLE: 503,
    } as const;
    return NextResponse.json(
      { error: code },
      { status: statuses[code], headers },
    );
  }
}
