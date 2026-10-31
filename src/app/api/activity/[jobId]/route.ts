import { NextResponse } from 'next/server';
import { getActivity } from '@/app/_lib/activity';
import { requireUuid } from '@/db/errors';
import { documentErrorResponse, privateHeaders } from '../../knowledge/http';
export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    requireUuid(jobId);
    return NextResponse.json(await (await getActivity()).detail(jobId), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
