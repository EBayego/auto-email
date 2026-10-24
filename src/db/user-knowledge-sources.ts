import 'server-only';
import { getServerConfig } from '@/config/env';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createKnowledgeSources } from './knowledge-sources';

export async function openUserKnowledgeSources(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createKnowledgeSources(
    createServiceDataClient(getServerConfig()),
    user.id,
  );
}
