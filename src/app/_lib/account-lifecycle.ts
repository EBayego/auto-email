import 'server-only';
import { createServerAuthClient } from './auth';
import { openUserAccountLifecycle } from '@/db/user-account-lifecycle';
export async function getAccountLifecycle() {
  return openUserAccountLifecycle(await createServerAuthClient(true));
}
