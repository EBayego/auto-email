import { randomBytes } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';
import { getAccountLifecycle } from '@/app/_lib/account-lifecycle';
import { createAccountDeletionRuntime } from '@/db/account-deletion-runtime';
import { DataAccessError } from '@/db/errors';
import { lifecycleOperationSchema } from '@/modules/account/lifecycle';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
  readKnowledgeJson,
} from '../../knowledge/http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  try {
    return NextResponse.json(await (await getAccountLifecycle()).get(), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const parsed = lifecycleOperationSchema.safeParse(
      await readKnowledgeJson(request, 2048),
    );
    if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
    const access = await getAccountLifecycle();
    if (parsed.data.action === 'reset_style') {
      await access.resetStyle();
      return NextResponse.json(
        { status: 'STYLE_DELETED' },
        { headers: privateHeaders },
      );
    }
    if (parsed.data.email.trim().toLowerCase() !== access.email.toLowerCase())
      throw new DataAccessError('INVALID_INPUT');
    const secret = randomBytes(32).toString('hex'),
      requestId = await access.requestDeletion(secret);
    const response = NextResponse.json(
      { status: 'QUEUED', requestId },
      { status: 202, headers: privateHeaders },
    );
    response.cookies.set('account-deletion-receipt', secret, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 86400,
    });
    await access.revokeSessions().catch(() => undefined);
    after(async () => {
      try {
        await createAccountDeletionRuntime()({ requestId, limit: 1 });
      } catch {
        /* The durable queue is retried by the worker. */
      }
    });
    return response;
  } catch (error) {
    return documentErrorResponse(error);
  }
}
