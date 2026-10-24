import { NextResponse, type NextRequest } from 'next/server';
import { getKnowledgeDocuments } from '@/app/_lib/knowledge-documents';
import { DataAccessError } from '@/db/errors';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
} from '../../../http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    checkDocumentOrigin(request);
    if (
      request.nextUrl.search ||
      Number(request.headers.get('content-length')) > 0
    )
      throw new DataAccessError('INVALID_INPUT');
    const documents = await getKnowledgeDocuments();
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength) {
            await reader.cancel();
            throw new DataAccessError('INVALID_INPUT');
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    return NextResponse.json(
      await documents.reindex((await context.params).documentId),
      { headers: privateHeaders },
    );
  } catch (error) {
    return documentErrorResponse(error);
  }
}
