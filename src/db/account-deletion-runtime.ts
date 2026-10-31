import { getServerConfig, type ServerConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';
import { createAccountDeletionStore } from './account-deletion';
import { createProviderClients } from '@/providers/runtime';
import { decryptGmailRefreshToken } from '@/modules/gmail/tokens';
import { runAccountDeletions } from '@/modules/account/lifecycle';
export function createAccountDeletionRuntime(
  config: ServerConfig = getServerConfig(),
) {
  const store = createAccountDeletionStore(
    createServiceDataClient(config),
    async (credential) => {
      if (config.providerMode !== 'live')
        throw new Error('REVOCATION_UNAVAILABLE');
      const token = decryptGmailRefreshToken(
        credential.token.reveal(),
        config.gmail.tokenEncryptionKey,
        credential.userId,
        credential.email,
      );
      await createProviderClients(config).googleAuthorization.revokeToken(
        token,
      );
    },
  );
  return (options?: Parameters<typeof runAccountDeletions>[1]) =>
    runAccountDeletions(store, options);
}
