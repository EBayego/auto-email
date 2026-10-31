import { NextResponse, type NextRequest } from 'next/server';
import { getOnboardingAccess } from '@/app/_lib/onboarding';
import { DataAccessError } from '@/db/errors';
import {
  OnboardingError,
  parseOnboardingOperation,
} from '@/modules/identity/onboarding';
import {
  checkDocumentOrigin,
  privateHeaders,
  readKnowledgeJson,
} from '../knowledge/http';

export const dynamic = 'force-dynamic';
function failed(error: unknown) {
  const code =
    error instanceof DataAccessError || error instanceof OnboardingError
      ? error.code
      : 'UNAVAILABLE';
  const status =
    code === 'UNAUTHENTICATED'
      ? 401
      : code === 'FORBIDDEN'
        ? 403
        : code === 'UNAVAILABLE'
          ? 503
          : [
                'STALE_CONSENT',
                'ANALYSIS_BUSY',
                'NOT_CONNECTED',
                'CONSENT_REQUIRED',
                'CANCELLED',
              ].includes(code)
            ? 409
            : 400;
  return NextResponse.json(
    { error: code },
    { status, headers: privateHeaders },
  );
}
export async function GET() {
  try {
    return NextResponse.json(
      { onboarding: await (await getOnboardingAccess()).get() },
      { headers: privateHeaders },
    );
  } catch (error) {
    return failed(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const operation = parseOnboardingOperation(
      await readKnowledgeJson(request),
    );
    const access = await getOnboardingAccess();
    await access.apply(operation);
    return NextResponse.json(
      { onboarding: await access.get() },
      {
        status: operation.action === 'start' ? 202 : 200,
        headers: privateHeaders,
      },
    );
  } catch (error) {
    return failed(error);
  }
}
