import 'server-only';
import { openUserGmailConnection } from '@/db/gmail-connection';
import { createServerAuthClient } from './auth';

export async function getGmailConnection() {
  return openUserGmailConnection(await createServerAuthClient(true));
}
