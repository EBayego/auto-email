import { NextResponse, type NextRequest } from 'next/server';
import { getKnowledgeDocuments } from '@/app/_lib/knowledge-documents';
import { DataAccessError } from '@/db/errors';
import { documentErrorResponse, privateHeaders } from '../../../http';

export const dynamic = 'force-dynamic';
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
) {
  try {
    const documents = await getKnowledgeDocuments();
    const params = request.nextUrl.searchParams;
    if (
      [...params.keys()].some((key) => !['offset', 'limit'].includes(key)) ||
      [...params.keys()].some((key) => params.getAll(key).length !== 1)
    )
      throw new DataAccessError('INVALID_INPUT');
    return NextResponse.json(
      await documents.chunks(
        (await context.params).documentId,
        Number(params.get('offset') ?? '0'),
        Number(params.get('limit') ?? '20'),
      ),
      { headers: privateHeaders },
    );
  } catch (error) {
    return documentErrorResponse(error);
  }
}
