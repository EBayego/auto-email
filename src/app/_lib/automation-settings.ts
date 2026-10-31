import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserAutomationSettings } from '@/db/user-automation-settings';
export async function getAutomationSettings() {
  return openUserAutomationSettings(await createServerAuthClient());
}
