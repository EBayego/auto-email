import type { NextRequest } from 'next/server';
import { manageGmail } from '../manage';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  return manageGmail(request, 'disconnect');
}
