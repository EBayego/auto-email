import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserActivity } from '@/db/user-activity';
export async function getActivity() {
  return openUserActivity(await createServerAuthClient());
}
