import { getWebServerConfig, type WebServerConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';
import { createAccountDeletionStore } from './account-deletion';
import { createGmailProviderClients } from '@/providers/runtime';
import { decryptGmailRefreshToken } from '@/modules/gmail/tokens';
import { runAccountDeletions } from '@/modules/account/lifecycle';
import { recoverErasureRequests } from './erasure-recovery';
export function createAccountDeletionRuntime(
  config: WebServerConfig = getWebServerConfig(),
) {
  const client = createServiceDataClient(config);
  const store = createAccountDeletionStore(client, async (credential) => {
    if (config.providerMode !== 'live')
      throw new Error('REVOCATION_UNAVAILABLE');
    const token = decryptGmailRefreshToken(
      credential.token.reveal(),
      config.gmail.tokenEncryptionKey,
      credential.userId,
      credential.email,
    );
    await createGmailProviderClients(config).googleAuthorization.revokeToken(
      token,
    );
  });
  return async (options?: Parameters<typeof runAccountDeletions>[1]) => {
    await recoverErasureRequests(client, options?.signal);
    return runAccountDeletions(store, options);
  };
}
