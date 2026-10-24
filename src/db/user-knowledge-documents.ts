import 'server-only';
import { getServerConfig } from '@/config/env';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createKnowledgeDocuments } from './knowledge-documents';

export async function openUserKnowledgeDocuments(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  return createKnowledgeDocuments(
    createServiceDataClient(getServerConfig()),
    user.id,
  );
}
