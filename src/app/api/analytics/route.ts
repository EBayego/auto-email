import { NextResponse, type NextRequest } from 'next/server';
import { getAnalytics } from '@/app/_lib/analytics';
import { DataAccessError } from '@/db/errors';
import { analyticsQuerySchema } from '@/modules/analytics/dashboard';
import { documentErrorResponse, privateHeaders } from '../knowledge/http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      throw new DataAccessError('INVALID_INPUT');
    const parsed = analyticsQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
    return NextResponse.json(await (await getAnalytics()).get(parsed.data), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
