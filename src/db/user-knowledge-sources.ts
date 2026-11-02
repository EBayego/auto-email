import 'server-only';
import { getDataServiceConfig } from '@/config/env';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createKnowledgeSources } from './knowledge-sources';

export async function openUserKnowledgeSources(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createKnowledgeSources(
    createServiceDataClient(getDataServiceConfig()),
    user.id,
  );
}
