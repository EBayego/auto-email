import { NextResponse, type NextRequest } from 'next/server';
import { getAuthConfig } from '@/modules/auth/config';
import { DataAccessError } from '@/db/errors';
import { DocumentError } from '@/modules/knowledge/documents';
import { SourceConfigurationError } from '@/modules/source-router/sources';
import { KnowledgeRetrievalError } from '@/modules/knowledge/retriever';

export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export async function readKnowledgeJson(
  request: NextRequest,
  limit = 16384,
): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
    Number(request.headers.get('content-length')) > limit ||
    !request.body
  )
    throw new DataAccessError('INVALID_INPUT');
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new DataAccessError('INVALID_INPUT');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    throw new DataAccessError('INVALID_INPUT');
  }
}
export function checkDocumentOrigin(request: NextRequest) {
  if (
    request.headers.get('origin') !== getAuthConfig().appOrigin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new DataAccessError('INVALID_INPUT');
}
export function documentErrorResponse(error: unknown) {
  const code =
    error instanceof DataAccessError ||
    error instanceof DocumentError ||
    error instanceof SourceConfigurationError ||
    error instanceof KnowledgeRetrievalError
      ? error.code
      : 'UNAVAILABLE';
  const status =
    code === 'UNAUTHENTICATED'
      ? 401
      : code === 'FORBIDDEN'
        ? 403
        : code === 'NOT_FOUND'
          ? 404
          : code === 'FILE_TOO_LARGE'
            ? 413
            : code === 'DOCUMENT_LIMIT' ||
                code === 'DOCUMENT_BUSY' ||
                error instanceof SourceConfigurationError
              ? 409
              : ['UNAVAILABLE', 'UPLOAD_FAILED', 'PROCESSING_FAILED'].includes(
                    code,
                  )
                ? 503
                : 400;
  return NextResponse.json(
    { error: code },
    { status, headers: privateHeaders },
  );
}
