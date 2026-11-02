import type { NextRequest } from 'next/server';

export function gmailRequestOriginMatches(
  request: NextRequest,
  appOrigin: string,
) {
  const expected = new URL(appOrigin);
  // NextURL normalizes loopback addresses to localhost. The HTTP Host keeps
  // the actual authority; never use client-supplied forwarded-host values.
  return (
    request.nextUrl.protocol === expected.protocol &&
    (request.headers.get('host') ?? request.nextUrl.host) === expected.host
  );
}
