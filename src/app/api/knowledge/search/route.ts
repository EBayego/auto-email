import { NextResponse, type NextRequest } from 'next/server';
import { getKnowledgeDocuments } from '@/app/_lib/knowledge-documents';
import { getKnowledgeSources } from '@/app/_lib/knowledge-sources';
import { DataAccessError } from '@/db/errors';
import { documentErrorResponse, privateHeaders } from '../http';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    if (
      [...params.keys()].some(
        (key) => !['q', 'limit', 'documentId', 'intent'].includes(key),
      ) ||
      [...params.keys()].some((key) => params.getAll(key).length !== 1)
    )
      throw new DataAccessError('INVALID_INPUT');
    if (params.has('intent')) {
      if (params.has('documentId')) throw new DataAccessError('INVALID_INPUT');
      const sources = await getKnowledgeSources();
      return NextResponse.json(
        await sources.retrieve({
          question: params.get('q') as string,
          intent: params.get('intent') as Parameters<
            typeof sources.retrieve
          >[0]['intent'],
          maxFragments: Number(params.get('limit') ?? '6'),
        }),
        { headers: privateHeaders },
      );
    }
    const documents = await getKnowledgeDocuments();
    const matches = await documents.search(
      params.get('q') ?? '',
      Number(params.get('limit') ?? '10'),
      params.get('documentId') ?? undefined,
    );
    return NextResponse.json({ matches }, { headers: privateHeaders });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
