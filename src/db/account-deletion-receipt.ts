import 'server-only';
import { getServerConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';
import { getDeletionReceipt } from './account-deletion';
export async function readAccountDeletionReceipt(secret: string) {
  return getDeletionReceipt(createServiceDataClient(getServerConfig()), secret);
}
