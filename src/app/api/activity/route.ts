import { NextResponse, type NextRequest } from 'next/server';
import { getActivity } from '@/app/_lib/activity';
import { DataAccessError } from '@/db/errors';
import { activityQuerySchema } from '@/modules/workflow/activity';
import { documentErrorResponse, privateHeaders } from '../knowledge/http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      throw new DataAccessError('INVALID_INPUT');
    const parsed = activityQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
    return NextResponse.json(await (await getActivity()).feed(parsed.data), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
