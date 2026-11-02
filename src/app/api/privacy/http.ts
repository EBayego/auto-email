import { NextResponse } from 'next/server';
import { PrivacyError } from '@/modules/privacy/notice';
import { documentErrorResponse, privateHeaders } from '../knowledge/http';

export function privacyErrorResponse(error: unknown) {
  if (error instanceof PrivacyError)
    return NextResponse.json(
      { error: error.code },
      { status: 409, headers: privateHeaders },
    );
  return documentErrorResponse(error);
}
