import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserOnboarding } from '@/db/user-onboarding';

export async function getOnboardingAccess() {
  return openUserOnboarding(await createServerAuthClient());
}
