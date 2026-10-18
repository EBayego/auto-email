import 'server-only';
import { getServerConfig } from '@/config/env';
import { createGmailConnection } from '@/modules/gmail/credentials';
import { createProviderClients } from '@/providers/runtime';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createGmailCredentialRepository } from './gmail-credential-repository';
import { requireResource } from './errors';

export async function openUserGmailConnection(client: DataClient) {
  const data = await openUserDataAccess(client);
  const account = requireResource(await data.gmailAccounts.get());
  const config = getServerConfig();
  if (config.providerMode !== 'live') throw new Error('GMAIL_UNAVAILABLE');
  return createGmailConnection({
    store: createGmailCredentialRepository(
      createServiceDataClient(config),
      data.user.id,
      account.id,
    ),
    providers: createProviderClients(config),
    encryptionKey: config.gmail.tokenEncryptionKey,
    timeoutMs: config.timeoutMs,
  });
}
