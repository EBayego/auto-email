import type { ServerConfig } from '@/config/env';
import { ConfigurationError } from '@/config/env';
import type { ProviderClients } from './contracts';
import { createOpenAiClient } from './openai';
import { createGoogleAuthorizationClient } from './google';
import { createGmailClient } from './gmail';
import type { ProviderRequestExecutor } from './request-policy';

export function createProviderClients(
  config: ServerConfig,
  mocks?: ProviderClients,
  execute?: ProviderRequestExecutor,
): ProviderClients {
  if (config.providerMode === 'mock') {
    if (config.environment !== 'test' || !mocks)
      throw new ConfigurationError(['PROVIDER_MODE']);
    return Object.freeze(mocks);
  }
  return Object.freeze({
    text: createOpenAiClient(
      config.openai,
      config.timeoutMs,
      undefined,
      execute,
    ),
    googleAuthorization: createGoogleAuthorizationClient(
      config.google,
      config.timeoutMs,
    ),
    gmail: (getAccessToken) =>
      createGmailClient(getAccessToken, config.timeoutMs, undefined, execute),
  });
}
