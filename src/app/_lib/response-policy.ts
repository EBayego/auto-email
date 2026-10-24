import 'server-only';
import { openUserResponsePolicy } from '@/db/user-response-policy';
import { createServerAuthClient } from './auth';

export async function getResponsePolicy() {
  return openUserResponsePolicy(await createServerAuthClient());
}
