import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserSharePoint } from '@/db/user-sharepoint';

export async function getSharePointContext() {
  return openUserSharePoint(await createServerAuthClient(true));
}
