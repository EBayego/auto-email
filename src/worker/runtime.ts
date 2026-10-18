import { getServerConfig, type ServerConfig } from '@/config/env';
import { createServiceDataClient } from '@/db/service-client';
import { createProviderClients } from '@/providers/runtime';
import type { ProviderClients } from '@/providers/contracts';
import { openWorkerDataAccess, type OwnedWorkItem } from './data-access';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { createGmailConnection } from '@/modules/gmail/credentials';

export function createWorkerRuntime(
  config: ServerConfig = getServerConfig(),
  mocks?: ProviderClients,
) {
  const client = createServiceDataClient(config);
  const providers = createProviderClients(config, mocks);
  return Object.freeze({
    providers,
    dataFor: (work: OwnedWorkItem) => openWorkerDataAccess(client, work),
    async gmailFor(work: OwnedWorkItem) {
      await openWorkerDataAccess(client, work);
      if (config.providerMode !== 'live') throw new Error('GMAIL_UNAVAILABLE');
      return createGmailConnection({
        store: createGmailCredentialRepository(
          client,
          work.userId,
          work.gmailAccountId,
        ),
        providers,
        encryptionKey: config.gmail.tokenEncryptionKey,
        timeoutMs: config.timeoutMs,
      }).client;
    },
  });
}
