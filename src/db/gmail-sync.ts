import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import type { GmailSyncStore, SyncClaim } from '@/worker/sync';

function parameters(claim: SyncClaim) {
  requireUuid(claim.userId);
  requireUuid(claim.gmailAccountId);
  requireUuid(claim.runId);
  return {
    p_user_id: claim.userId,
    p_account_id: claim.gmailAccountId,
    p_run_id: claim.runId,
  };
}

async function checked<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  try {
    const result = await query;
    if (result.error || result.data === null)
      throw new DataAccessError('UNAVAILABLE');
    return result.data!;
  } catch {
    throw new DataAccessError('UNAVAILABLE');
  }
}

export function createGmailSyncStore(client: DataClient): GmailSyncStore {
  return Object.freeze({
    async claim(config) {
      const rows = await checked(
        client.rpc('claim_gmail_sync', {
          p_lease_seconds: config.leaseSeconds,
          p_overlap_seconds: config.overlapSeconds,
          p_initial_lookback_seconds: config.initialLookbackSeconds,
        }),
      );
      if (rows.length > 1) throw new DataAccessError('UNAVAILABLE');
      const row = rows[0];
      if (!row) return null;
      const claim = {
        userId: row.user_id,
        gmailAccountId: row.gmail_account_id,
        runId: row.run_id,
        windowStartAt: row.window_start_at,
        windowEndAt: row.window_end_at,
      };
      parameters(claim);
      if (
        !Number.isFinite(Date.parse(claim.windowStartAt)) ||
        !Number.isFinite(Date.parse(claim.windowEndAt)) ||
        Date.parse(claim.windowStartAt) >= Date.parse(claim.windowEndAt)
      )
        throw new DataAccessError('UNAVAILABLE');
      return claim;
    },
    async renew(claim, leaseSeconds) {
      return checked(
        client.rpc('renew_gmail_sync', {
          ...parameters(claim),
          p_lease_seconds: leaseSeconds,
        }),
      );
    },
    async recordPage(claim, messages) {
      return checked(
        client.rpc('record_gmail_sync_page', {
          ...parameters(claim),
          p_messages: messages.map(({ id, threadId }) => ({ id, threadId })),
        }),
      );
    },
    async finish(claim, errorCode) {
      if (errorCode !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(errorCode))
        throw new DataAccessError('INVALID_INPUT');
      return checked(
        client.rpc('finish_gmail_sync', {
          ...parameters(claim),
          p_success: errorCode === undefined,
          p_error_code: errorCode,
        }),
      );
    },
  } satisfies GmailSyncStore);
}
