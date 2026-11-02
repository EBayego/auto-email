import 'server-only';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { getDataServiceConfig } from '@/config/env';
import { createPrivacyRepository } from './privacy';
import { exportPrivacyData } from './privacy-export';

export async function openUserPrivacy(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  const writer = createServiceDataClient(getDataServiceConfig());
  return Object.freeze({
    ...createPrivacyRepository(writer, user.id),
    export: async () => ({
      email: user.email,
      ...(await exportPrivacyData(writer, user.id)),
    }),
  });
}
