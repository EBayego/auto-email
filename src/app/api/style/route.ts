import { NextResponse, type NextRequest } from 'next/server';
import { getStyleEditorAccess } from '@/app/_lib/style-editor';
import { DataAccessError } from '@/db/errors';
import {
  StyleEditorError,
  parseStyleEditorOperation,
} from '@/modules/identity/style-editor';
import {
  checkDocumentOrigin,
  privateHeaders,
  readKnowledgeJson,
} from '../knowledge/http';
export const dynamic = 'force-dynamic';
function failed(error: unknown) {
  const code =
    error instanceof DataAccessError || error instanceof StyleEditorError
      ? error.code
      : 'UNAVAILABLE';
  const status =
    code === 'UNAUTHENTICATED'
      ? 401
      : code === 'FORBIDDEN'
        ? 403
        : code === 'UNAVAILABLE'
          ? 503
          : code === 'INVALID_INPUT'
            ? 400
            : 409;
  return NextResponse.json(
    { error: code },
    { status, headers: privateHeaders },
  );
}
export async function GET() {
  try {
    return NextResponse.json(
      { style: await (await getStyleEditorAccess()).get() },
      { headers: privateHeaders },
    );
  } catch (error) {
    return failed(error);
  }
}
export async function PUT(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const operation = parseStyleEditorOperation(
      await readKnowledgeJson(request),
    );
    const access = await getStyleEditorAccess();
    await access.apply(operation);
    return NextResponse.json(
      { style: await access.get() },
      { headers: privateHeaders },
    );
  } catch (error) {
    return failed(error);
  }
}
