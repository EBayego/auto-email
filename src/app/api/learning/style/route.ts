import { NextResponse, type NextRequest } from 'next/server';
import { getStyleLearningAccess } from '@/app/_lib/style-learning';
import {
  StyleLearningError,
  styleLearningOperationSchema,
} from '@/modules/identity/style-learning';
import { DataAccessError } from '@/db/errors';
import { PrivacyError } from '@/modules/privacy/notice';
import {
  checkDocumentOrigin,
  privateHeaders,
  readKnowledgeJson,
} from '../../knowledge/http';
export const dynamic = 'force-dynamic';
function failed(error: unknown) {
  const code =
    error instanceof StyleLearningError ||
    error instanceof DataAccessError ||
    error instanceof PrivacyError
      ? error.code
      : 'UNAVAILABLE';
  const status =
    code === 'UNAUTHENTICATED'
      ? 401
      : code === 'FORBIDDEN'
        ? 403
        : code === 'NOT_FOUND'
          ? 404
          : code === 'INVALID_INPUT'
            ? 400
            : code === 'UNAVAILABLE'
              ? 503
              : 409;
  return NextResponse.json(
    { error: code },
    { status, headers: privateHeaders },
  );
}
export async function GET() {
  try {
    return NextResponse.json(await (await getStyleLearningAccess()).get(), {
      headers: privateHeaders,
    });
  } catch (error) {
    return failed(error);
  }
}
export async function PUT(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const input = styleLearningOperationSchema.safeParse(
      await readKnowledgeJson(request, 4096),
    );
    if (!input.success) throw new StyleLearningError('INVALID_INPUT');
    const access = await getStyleLearningAccess();
    await access.apply(input.data);
    return NextResponse.json(await access.get(), { headers: privateHeaders });
  } catch (error) {
    return failed(error);
  }
}
