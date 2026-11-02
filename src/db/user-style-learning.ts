import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { getDataServiceConfig } from '@/config/env';
import { createStyleLearningRepository } from './style-learning';
import { StyleLearningError } from '@/modules/identity/style-learning';
export async function openUserStyleLearning(client: DataClient) {
  const data = await openUserDataAccess(client),
    gmail = await data.gmailAccounts.get();
  if (gmail?.status !== 'CONNECTED')
    throw new StyleLearningError('NOT_CONNECTED');
  return createStyleLearningRepository(
    createServiceDataClient(getDataServiceConfig()),
    data.user.id,
    gmail.id,
  );
}
