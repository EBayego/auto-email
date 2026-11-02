import 'server-only';
import { getDataServiceConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';
import { getDeletionReceipt } from './account-deletion';
export async function readAccountDeletionReceipt(secret: string) {
  return getDeletionReceipt(
    createServiceDataClient(getDataServiceConfig()),
    secret,
  );
}
