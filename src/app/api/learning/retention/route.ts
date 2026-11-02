import { NextResponse, type NextRequest } from 'next/server';
import { getGenerationRetention } from '@/app/_lib/generation-retention';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
  readKnowledgeJson,
} from '../../knowledge/http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get('accountId') ?? '';
    return NextResponse.json(
      await (await getGenerationRetention()).get(accountId),
      { headers: privateHeaders },
    );
  } catch (error) {
    return documentErrorResponse(error);
  }
}
export async function PUT(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    await (
      await getGenerationRetention()
    ).set(await readKnowledgeJson(request, 1024));
    return new NextResponse(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
