import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { getDataServiceConfig } from '@/config/env';
import { createAnalyticsRepository } from './analytics-dashboard';
export async function openUserAnalytics(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createAnalyticsRepository(
    createServiceDataClient(getDataServiceConfig()),
    user.id,
  );
}
