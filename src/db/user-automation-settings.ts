import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { getServerConfig } from '@/config/env';
import { createAutomationSettingsRepository } from './automation-settings';
export async function openUserAutomationSettings(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createAutomationSettingsRepository(
    createServiceDataClient(getServerConfig()),
    user.id,
  );
}
