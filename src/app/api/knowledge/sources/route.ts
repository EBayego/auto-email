import { NextResponse, type NextRequest } from 'next/server';
import { getKnowledgeSources } from '@/app/_lib/knowledge-sources';
import { DataAccessError } from '@/db/errors';
import { sourceOperationSchema } from '@/modules/source-router/sources';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
} from '../http';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(await (await getKnowledgeSources()).list(), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const sources = await getKnowledgeSources();
    if (
      request.headers.get('content-type')?.split(';')[0] !==
        'application/json' ||
      Number(request.headers.get('content-length')) > 16384 ||
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
        if (size > 16384) {
          await reader.cancel();
          throw new DataAccessError('INVALID_INPUT');
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch {
      throw new DataAccessError('INVALID_INPUT');
    }
    const parsed = sourceOperationSchema.safeParse(value);
    if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
    return NextResponse.json(await sources.mutate(parsed.data), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
