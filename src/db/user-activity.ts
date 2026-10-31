import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { getServerConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';
import { createActivityRepository } from './activity';
export async function openUserActivity(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createActivityRepository(
    createServiceDataClient(getServerConfig()),
    user.id,
  );
}
