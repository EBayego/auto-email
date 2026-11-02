import { readSharePointConfig } from '@/config/sharepoint';
import { createSharePointStore } from './sharepoint';
import type { DataClient } from './models';
import {
  createSharePointService,
  verifySharePointEvidence,
  type ExternalReference,
} from '@/modules/sharepoint/service';
import { SharePointError } from '@/modules/sharepoint/contracts';

export async function checkExternalEvidence(
  client: DataClient,
  userId: string,
  refs: ExternalReference[],
  forDraft = false,
) {
  if (!refs.some((r) => r.connector_id)) return new Map();
  const config = readSharePointConfig();
  if (!config) throw new SharePointError('CONNECTOR_DISABLED');
  const store = createSharePointStore(client, userId);
  const service = createSharePointService(config, store, userId);
  return verifySharePointEvidence(store, service.graph, refs, { forDraft });
}
