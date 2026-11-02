import 'server-only';
import { getDataServiceConfig } from '@/config/env';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createExecutionControlRepository } from './execution-controls';

export async function openUserExecutionControls(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createExecutionControlRepository(
    createServiceDataClient(getDataServiceConfig()),
    user.id,
  );
}
