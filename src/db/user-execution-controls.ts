import 'server-only';
import { getServerConfig } from '@/config/env';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createExecutionControlRepository } from './execution-controls';

export async function openUserExecutionControls(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createExecutionControlRepository(
    createServiceDataClient(getServerConfig()),
    user.id,
  );
}
