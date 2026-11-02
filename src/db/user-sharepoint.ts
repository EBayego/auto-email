import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createSharePointStore } from './sharepoint';
import { getDataServiceConfig } from '@/config/env';
import { readSharePointConfig } from '@/config/sharepoint';
import { createSharePointService } from '@/modules/sharepoint/service';
import { SharePointError } from '@/modules/sharepoint/contracts';

export async function openUserSharePoint(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  const config = readSharePointConfig();
  if (!config) throw new SharePointError('CONNECTOR_DISABLED');
  const store = createSharePointStore(
    createServiceDataClient(getDataServiceConfig()),
    user.id,
  );
  return createSharePointService(config, store, user.id);
}
