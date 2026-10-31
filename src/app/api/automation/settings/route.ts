import { NextResponse, type NextRequest } from 'next/server';
import { getAutomationSettings } from '@/app/_lib/automation-settings';
import { DataAccessError } from '@/db/errors';
import {
  AutomationSettingsError,
  automationUpdateSchema,
} from '@/modules/workflow/automation-settings';
import {
  checkDocumentOrigin,
  documentErrorResponse,
  privateHeaders,
  readKnowledgeJson,
} from '../../knowledge/http';
export const dynamic = 'force-dynamic';
function failed(error: unknown) {
  if (error instanceof AutomationSettingsError)
    return NextResponse.json(
      { error: error.code },
      { status: 409, headers: privateHeaders },
    );
  return documentErrorResponse(error);
}
export async function GET() {
  try {
    return NextResponse.json(await (await getAutomationSettings()).get(), {
      headers: privateHeaders,
    });
  } catch (error) {
    return failed(error);
  }
}
export async function PUT(request: NextRequest) {
  try {
    checkDocumentOrigin(request);
    const parsed = automationUpdateSchema.safeParse(
      await readKnowledgeJson(request, 65536),
    );
    if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
    return NextResponse.json(
      await (await getAutomationSettings()).set(parsed.data),
      { headers: privateHeaders },
    );
  } catch (error) {
    return failed(error);
  }
}
