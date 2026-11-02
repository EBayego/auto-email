import { NextResponse, type NextRequest } from 'next/server';
import { getSharePointContext } from '@/app/_lib/sharepoint';
import { SharePointError } from '@/modules/sharepoint/contracts';
import { z } from 'zod';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
  readKnowledgeJson,
} from '../http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const service = await getSharePointContext();
    const params = request.nextUrl.searchParams;
    if (
      [...params.keys()].some(
        (k) => !['id', 'offset'].includes(k) || params.getAll(k).length !== 1,
      )
    )
      throw new SharePointError('INVALID_INPUT');
    return NextResponse.json(
      params.has('id')
        ? {
            items: await service.items(
              params.get('id')!,
              Number(params.get('offset') ?? 0),
            ),
          }
        : await service.snapshot(),
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof SharePointError && error.code === 'CONNECTOR_DISABLED')
      return NextResponse.json(
        {
          enabled: false,
          configured: false,
          ocrConfigured: false,
          connections: [],
          connectors: [],
        },
        { headers: privateHeaders },
      );
    return documentErrorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const service = await getSharePointContext();
    const value = await readKnowledgeJson(request);
    const operation = z.object({ action: z.string() }).parse(value);
    const result =
      operation.action === 'browse'
        ? await service.browse(
            z
              .strictObject({
                action: z.literal('browse'),
                connectionId: z.uuid(),
                siteUrl: z.string().max(4096).optional(),
                siteId: z.string().max(512).optional(),
                driveId: z.string().max(512).optional(),
                itemId: z.string().max(512).optional(),
                next: z.string().max(8192).optional(),
              })
              .parse(value),
          )
        : await service.operate(value);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
