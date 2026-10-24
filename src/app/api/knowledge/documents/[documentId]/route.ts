import { NextResponse, type NextRequest } from 'next/server';
import { getKnowledgeDocuments } from '@/app/_lib/knowledge-documents';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
  readKnowledgeJson,
} from '../../http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ documentId: string }> };
export async function GET(_request: NextRequest, context: Context) {
  try {
    const { documentId } = await context.params;
    const { document, blob } = await (
      await getKnowledgeDocuments()
    ).download(documentId);
    return new NextResponse(blob, {
      headers: {
        ...privateHeaders,
        'Content-Type': document.mime_type,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.name).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
export async function DELETE(request: NextRequest, context: Context) {
  try {
    checkDocumentOrigin(request);
    await (
      await getKnowledgeDocuments()
    ).remove((await context.params).documentId);
    return new NextResponse(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    checkDocumentOrigin(request);
    const documents = await getKnowledgeDocuments();
    await documents.setValidity(
      (await context.params).documentId,
      await readKnowledgeJson(request, 1024),
    );
    return new NextResponse(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
