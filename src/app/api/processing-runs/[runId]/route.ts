import { userDataResponse } from '@/app/_lib/data';
import { requireResource } from '@/db/errors';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  return userDataResponse(async (data) =>
    requireResource(await data.processingRuns.findById((await params).runId)),
  );
}
