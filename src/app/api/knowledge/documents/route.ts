import { NextResponse, type NextRequest } from 'next/server';
import { getKnowledgeDocuments } from '@/app/_lib/knowledge-documents';
import { DocumentError, documentLimits } from '@/modules/knowledge/documents';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
} from '../http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json(
      { documents: await (await getKnowledgeDocuments()).list() },
      { headers: privateHeaders },
    );
  } catch (error) {
    return documentErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const documents = await getKnowledgeDocuments();
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('multipart/form-data;')
    )
      throw new DocumentError('INVALID_FILE');
    const maxBody = documentLimits.maxBytes + 16 * 1024;
    if (Number(request.headers.get('content-length')) > maxBody)
      throw new DocumentError('FILE_TOO_LARGE');
    if (!request.body) throw new DocumentError('INVALID_FILE');
    const reader = request.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBody) {
          await reader.cancel();
          throw new DocumentError('FILE_TOO_LARGE');
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(parts), {
        headers: { 'content-type': request.headers.get('content-type')! },
      }).formData();
    } catch {
      throw new DocumentError('INVALID_FILE');
    }
    if ([...form.keys()].length !== 1) throw new DocumentError('INVALID_FILE');
    const file = form.get('file');
    if (!(file instanceof File)) throw new DocumentError('INVALID_FILE');
    return NextResponse.json(
      { document: await documents.upload(file) },
      { status: 201, headers: privateHeaders },
    );
  } catch (error) {
    return documentErrorResponse(error);
  }
}
