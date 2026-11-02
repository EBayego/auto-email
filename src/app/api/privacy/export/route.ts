import { NextResponse } from 'next/server';
import { getPrivacyAccess } from '@/app/_lib/privacy';
import { privateHeaders } from '../../knowledge/http';
import { privacyErrorResponse } from '../http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const exported = await (await getPrivacyAccess()).export();
    return NextResponse.json(exported, {
      headers: {
        ...privateHeaders,
        'Content-Disposition': 'attachment; filename="auto-email-datos.json"',
      },
    });
  } catch (error) {
    return privacyErrorResponse(error);
  }
}
