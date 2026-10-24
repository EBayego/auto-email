import type { DataClient } from './models';
import { DataAccessError } from './errors';
import {
  reconciliationAttemptSchema,
  type ReconciliationAttempt,
  type ReconciliationResult,
} from '@/modules/gmail/draft-reconciliation';

export function createDraftReconciliationStore(client: DataClient) {
  return Object.freeze({
    async claim(limit: number): Promise<ReconciliationAttempt[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client.rpc('claim_draft_reconciliation', {
        p_limit: limit,
        p_lease_seconds: 120,
      });
      if (error || !data || data.length > limit)
        throw new DataAccessError('UNAVAILABLE');
      return data.map((d) => {
        const parsed = reconciliationAttemptSchema.safeParse({
          id: d.id,
          userId: d.user_id,
          gmailAccountId: d.gmail_account_id,
          threadId: d.thread_id,
          targetMessageId: d.target_message_id,
          draftId: d.draft_id,
          writeStartedAt: d.write_started_at,
          leaseId: d.reconciliation_lease_id,
          intent: d.delivery_intent,
        });
        if (!parsed.success) throw new DataAccessError('UNAVAILABLE');
        return parsed.data;
      });
    },
    async finish(attempt: ReconciliationAttempt, result: ReconciliationResult) {
      const parsed = reconciliationAttemptSchema.safeParse(attempt);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client.rpc('finish_draft_reconciliation', {
        p_user_id: attempt.userId,
        p_account_id: attempt.gmailAccountId,
        p_attempt_id: attempt.id,
        p_lease_id: attempt.leaseId,
        p_result: result.result,
        ...('draftId' in result
          ? { p_draft_id: result.draftId, p_message_id: result.messageId }
          : {}),
      });
      if (error || typeof data !== 'boolean')
        throw new DataAccessError('UNAVAILABLE');
      return data;
    },
  });
}
