import type { DataClient } from './models';
import { assertPrivacyAuthorized } from './privacy';
import {
  directProviderRequest,
  type ProviderRequestExecutor,
} from '@/providers/request-policy';

export function createPrivacyRequestExecutor(
  client: DataClient,
  userId: string,
  execute: ProviderRequestExecutor = directProviderRequest,
): ProviderRequestExecutor {
  return (provider, safe, operation, before) =>
    execute(
      provider,
      safe,
      async (remaining) => {
        await assertPrivacyAuthorized(client, userId);
        return operation(remaining);
      },
      async () => {
        await assertPrivacyAuthorized(client, userId);
        await before?.();
      },
    );
}
