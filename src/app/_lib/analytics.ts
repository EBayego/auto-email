import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserAnalytics } from '@/db/user-analytics';
export async function getAnalytics() {
  return openUserAnalytics(await createServerAuthClient());
}
