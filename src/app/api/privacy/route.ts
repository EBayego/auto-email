import { NextResponse, type NextRequest } from 'next/server';
import { getPrivacyAccess } from '@/app/_lib/privacy';
import { DataAccessError } from '@/db/errors';
import { privacyOperationSchema } from '@/modules/privacy/notice';
import {
  checkDocumentOrigin,
  privateHeaders,
  readKnowledgeJson,
} from '../knowledge/http';
import { privacyErrorResponse } from './http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  try {
    return NextResponse.json(await (await getPrivacyAccess()).get(), {
      headers: privateHeaders,
    });
  } catch (error) {
    return privacyErrorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const parsed = privacyOperationSchema.safeParse(
      await readKnowledgeJson(request, 2048),
    );
    if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
    const access = await getPrivacyAccess();
    await access.apply(parsed.data);
    return NextResponse.json(await access.get(), { headers: privateHeaders });
  } catch (error) {
    return privacyErrorResponse(error);
  }
}
