import 'server-only';
import { getServerConfig } from '@/config/env';
import { openGmailOAuthData } from '@/db/gmail-oauth';
import { createGmailOAuthService } from '@/modules/gmail/oauth';
import { createServerAuthClient } from './auth';
import { getProviders } from './providers';

export async function getGmailOAuthService() {
  const context = await openGmailOAuthData(await createServerAuthClient(true));
  const config = getServerConfig();
  if (config.providerMode !== 'live') throw new Error('GMAIL_UNAVAILABLE');
  return createGmailOAuthService({
    userId: context.user.id,
    store: context.store,
    encryptionKey: config.gmail.tokenEncryptionKey,
    providers: getProviders(),
  });
}
