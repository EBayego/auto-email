import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { getDataServiceConfig } from '@/config/env';
import { createUserOnboardingRepository } from './onboarding';

export async function openUserOnboarding(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createUserOnboardingRepository(
    client,
    createServiceDataClient(getDataServiceConfig()),
    user.id,
  );
}
