import 'server-only';
import { openUserPrivacy } from '@/db/user-privacy';
import { createServerAuthClient } from './auth';

export async function getPrivacyAccess() {
  return openUserPrivacy(await createServerAuthClient(true));
}
