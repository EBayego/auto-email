import { isApplicationDatabaseReady } from '@/db/application-readiness';
import { getErasureLedger } from '@/modules/security/erasure-ledger';

export const dynamic = 'force-dynamic';
export async function GET() {
  let ready = false;
  try {
    if (process.env.SECURITY_MAINTENANCE_MODE === 'true') throw new Error();
    await getErasureLedger()?.verify();
    ready = await isApplicationDatabaseReady();
  } catch {
    /* Public health responses contain no configuration, errors or identifiers. */
  }
  return Response.json(
    { status: ready ? 'ok' : 'unavailable' },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
