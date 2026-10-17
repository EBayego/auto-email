import { type NextRequest } from 'next/server';
import { userDataResponse } from '@/app/_lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return userDataResponse((data) =>
    data.processingRuns.list(
      Number(request.nextUrl.searchParams.get('limit') ?? 20),
    ),
  );
}
