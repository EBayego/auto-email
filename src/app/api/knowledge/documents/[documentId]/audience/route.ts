import { NextResponse, type NextRequest } from 'next/server';
import { getKnowledgeDocuments } from '@/app/_lib/knowledge-documents';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
  readKnowledgeJson,
} from '../../../http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    checkDocumentOrigin(request);
    await (
      await getKnowledgeDocuments()
    ).setAudience(
      (await context.params).documentId,
      await readKnowledgeJson(request, 1024),
    );
    return new NextResponse(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
