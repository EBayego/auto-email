import { randomBytes } from 'node:crypto';
import type { WebServerConfig } from '@/config/env';
import type { DataClient } from './models';
import { createAccountLifecycleRepository } from './account-deletion';
import { createAccountDeletionRuntime } from './account-deletion-runtime';
import {
  getErasureLedger,
  SecurityStateError,
} from '@/modules/security/erasure-ledger';
import { DataAccessError } from './errors';

export async function containSecurityIncident(client: DataClient) {
  const { data, error } = await client.rpc('contain_security_incident');
  if (error || data !== true) throw new DataAccessError('UNAVAILABLE');
}
export async function verifyErasureReplay(client: DataClient) {
  const ledger = getErasureLedger();
  if (!ledger) throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
  for (const record of await ledger.entries()) {
    const found = await client.auth.admin.getUserById(record.userId);
    if (found.error && found.error.status !== 404)
      throw new DataAccessError('UNAVAILABLE');
    if (found.data.user)
      throw new SecurityStateError('RESTORE_REPLAY_INCOMPLETE');
  }
}
export async function replayErasureLedger(
  client: DataClient,
  config: WebServerConfig,
  runDeletion = createAccountDeletionRuntime(config),
) {
  if (process.env.SECURITY_MAINTENANCE_MODE !== 'true')
    throw new SecurityStateError('SECURITY_MAINTENANCE');
  await containSecurityIncident(client);
  const ledger = getErasureLedger();
  if (!ledger) throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
  const records = await ledger.entries();
  let completed = 0;
  for (const record of records) {
    const found = await client.auth.admin.getUserById(record.userId);
    if (found.error && found.error.status !== 404)
      throw new DataAccessError('UNAVAILABLE');
    if (!found.data.user) continue;
    const requestId = await createAccountLifecycleRepository(
      client,
      record.userId,
    ).requestDeletion(randomBytes(32).toString('hex'));
    await runDeletion({ requestId, limit: 1 });
    const remaining = await client.auth.admin.getUserById(record.userId);
    if (
      remaining.data.user ||
      (remaining.error && remaining.error.status !== 404)
    )
      throw new SecurityStateError('RESTORE_REPLAY_INCOMPLETE');
    completed++;
  }
  const purge = await client.rpc('purge_private_data');
  if (purge.error) throw new DataAccessError('UNAVAILABLE');
  return { completed };
}
