import { getDataServiceConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';

export async function isApplicationDatabaseReady() {
  const { data, error } = await createServiceDataClient({
    ...getDataServiceConfig(),
    timeoutMs: 2000,
  })
    .from('operational_monitor_state')
    .select('singleton')
    .eq('singleton', true)
    .limit(1);
  return !error && data?.length === 1;
}
