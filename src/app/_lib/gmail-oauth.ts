import 'server-only';
import { getWebServerConfig } from '@/config/env';
import { openGmailOAuthData } from '@/db/gmail-oauth';
import { createGmailOAuthService } from '@/modules/gmail/oauth';
import { createServerAuthClient } from './auth';
import { createGmailProviderClients } from '@/providers/runtime';

export async function getGmailOAuthService() {
  const context = await openGmailOAuthData(await createServerAuthClient(true));
  const config = getWebServerConfig();
  if (config.providerMode !== 'live') throw new Error('GMAIL_UNAVAILABLE');
  return createGmailOAuthService({
    userId: context.user.id,
    store: context.store,
    encryptionKey: config.gmail.tokenEncryptionKey,
    providers: createGmailProviderClients(config, context.execute),
  });
}
