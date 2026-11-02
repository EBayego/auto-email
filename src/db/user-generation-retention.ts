import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { getDataServiceConfig } from '@/config/env';
import { createGenerationRetentionRepository } from './generation-retention';
export async function openUserGenerationRetention(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createGenerationRetentionRepository(
    createServiceDataClient(getDataServiceConfig()),
    user.id,
  );
}
