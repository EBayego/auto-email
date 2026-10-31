import { NextResponse, type NextRequest } from 'next/server';
import { readAccountDeletionReceipt } from '@/db/account-deletion-receipt';
import { DataAccessError } from '@/db/errors';
import { documentErrorResponse, privateHeaders } from '../../knowledge/http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const secret = request.cookies.get('account-deletion-receipt')?.value;
    if (!secret) throw new DataAccessError('NOT_FOUND');
    return NextResponse.json(await readAccountDeletionReceipt(secret), {
      headers: privateHeaders,
    });
  } catch (error) {
    return documentErrorResponse(error);
  }
}
