import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAuthConfig } from '@/modules/auth/config';
import { getSharePointContext } from '@/app/_lib/sharepoint';
import { microsoftOAuthCookie } from '@/modules/sharepoint/auth';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
  readKnowledgeJson,
} from '@/app/api/knowledge/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    z.strictObject({ acknowledged: z.literal(true) }).parse(
      await readKnowledgeJson(request, 1024),
    );
    const { state, url } = await (await getSharePointContext()).auth.begin();
    const response = NextResponse.json({ url }, { headers: privateHeaders });
    response.cookies.set(microsoftOAuthCookie, state, {
      httpOnly: true,
      secure: getAuthConfig().secureCookies,
      sameSite: 'lax',
      path: '/api/connectors/microsoft',
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return documentErrorResponse(error);
  }
}
