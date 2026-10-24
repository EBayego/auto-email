import 'server-only';
import { getServerConfig } from '@/config/env';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createResponsePolicyRepository } from './response-policy';

export async function openUserResponsePolicy(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createResponsePolicyRepository(
    createServiceDataClient(getServerConfig()),
    user.id,
  );
}
