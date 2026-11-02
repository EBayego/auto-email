import 'server-only';
import { getWebServerConfig } from '@/config/env';
import { createGmailConnection } from '@/modules/gmail/credentials';
import { createGmailProviderClients } from '@/providers/runtime';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createGmailCredentialRepository } from './gmail-credential-repository';
import { requireResource } from './errors';
import { createPrivacyRequestExecutor } from './privacy-provider';

export async function openUserGmailConnection(client: DataClient) {
  const data = await openUserDataAccess(client);
  const account = requireResource(await data.gmailAccounts.get());
  const config = getWebServerConfig();
  if (config.providerMode !== 'live') throw new Error('GMAIL_UNAVAILABLE');
  const service = createServiceDataClient(config);
  return createGmailConnection({
    store: createGmailCredentialRepository(service, data.user.id, account.id),
    providers: createGmailProviderClients(
      config,
      createPrivacyRequestExecutor(service, data.user.id),
    ),
    encryptionKey: config.gmail.tokenEncryptionKey,
    timeoutMs: config.timeoutMs,
  });
}
