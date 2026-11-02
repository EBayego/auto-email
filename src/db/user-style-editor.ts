import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createStyleEditorRepository } from './style-editor';
import { StyleEditorError } from '@/modules/identity/style-editor';
import { getDataServiceConfig } from '@/config/env';

export async function openUserStyleEditor(client: DataClient) {
  const data = await openUserDataAccess(client);
  const gmail = await data.gmailAccounts.get();
  if (gmail?.status !== 'CONNECTED')
    throw new StyleEditorError('NOT_CONNECTED');
  return createStyleEditorRepository(
    client,
    createServiceDataClient(getDataServiceConfig()),
    data.user.id,
    gmail.id,
  );
}
