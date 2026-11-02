import type { DataClient } from './models';
import { getErasureLedger } from '@/modules/security/erasure-ledger';
import { AccountDeletionError } from '@/modules/account/lifecycle';

export async function recoverErasureRequests(
  client: DataClient,
  signal?: AbortSignal,
) {
  const ledger = getErasureLedger();
  if (!ledger || signal?.aborted) return;
  const records = await ledger.entries();
  for (
    let offset = 0;
    offset < records.length && !signal?.aborted;
    offset += 100
  ) {
    const ids = records
      .slice(offset, offset + 100)
      .map((record) => record.userId);
    const [owners, requests] = await Promise.all([
      client.from('users').select('id,status').in('id', ids),
      client
        .from('account_deletion_requests')
        .select('user_id')
        .in('user_id', ids),
    ]);
    if (owners.error || requests.error || !owners.data || !requests.data)
      throw new AccountDeletionError('DATABASE_UNAVAILABLE');
    const queued = new Set(requests.data.map((request) => request.user_id));
    for (const owner of owners.data) {
      if (signal?.aborted) return;
      if (queued.has(owner.id)) continue; // Preserve existing receipts and retry state.
      const result = await client.rpc('recover_erasure_request', {
        p_user_id: owner.id,
      });
      if (result.error) throw new AccountDeletionError('DATABASE_UNAVAILABLE');
    }
  }
}
