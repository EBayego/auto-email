import { NextResponse, type NextRequest } from 'next/server';
import { getResponsePolicy } from '@/app/_lib/response-policy';
import { DataAccessError } from '@/db/errors';
import {
  responsePolicySettingsSchema,
  responsePolicyVersion,
} from '@/modules/policy/settings';
import {
  checkDocumentOrigin,
  readKnowledgeJson,
  documentErrorResponse,
  privateHeaders,
} from '../knowledge/http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(
      {
        ...(await (await getResponsePolicy()).get()),
        engineVersion: responsePolicyVersion,
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return documentErrorResponse(error);
  }
}
export async function PUT(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const repository = await getResponsePolicy();
    const parsed = responsePolicySettingsSchema.safeParse(
      await readKnowledgeJson(request, 65536),
    );
    if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
    return NextResponse.json(await repository.set(parsed.data), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
