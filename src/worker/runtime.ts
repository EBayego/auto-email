import { getServerConfig, type ServerConfig } from '@/config/env';
import { createServiceDataClient } from '@/db/service-client';
import { createProviderClients } from '@/providers/runtime';
import type { ProviderClients } from '@/providers/contracts';
import { openWorkerDataAccess, type OwnedWorkItem } from './data-access';

export function createWorkerRuntime(
  config: ServerConfig = getServerConfig(),
  mocks?: ProviderClients,
) {
  const client = createServiceDataClient(config);
  return Object.freeze({
    providers: createProviderClients(config, mocks),
    dataFor: (work: OwnedWorkItem) => openWorkerDataAccess(client, work),
  });
}
