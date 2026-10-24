import type { GmailClient } from '@/providers/contracts';
import {
  reconcileGmailDraft,
  type ReconciliationAttempt,
  type ReconciliationResult,
} from '@/modules/gmail/draft-reconciliation';

export async function runDraftReconciliation(
  input: {
    store: {
      claim(limit: number): Promise<ReconciliationAttempt[]>;
      finish(
        attempt: ReconciliationAttempt,
        result: ReconciliationResult,
      ): Promise<boolean>;
    };
    gmailFor(attempt: ReconciliationAttempt): Promise<Pick<GmailClient, 'get'>>;
    report(event: {
      type: 'DRAFT_RECONCILED' | 'DRAFT_RECONCILIATION_FAILED';
      accountId: string;
      attemptId: string;
      reasonCode: string;
    }): void;
  },
  limit: number,
  signal?: AbortSignal,
) {
  const attempts = await input.store.claim(Math.min(limit, 100));
  for (const attempt of attempts) {
    if (signal?.aborted) break;
    try {
      const result = attempt.writeStartedAt
        ? await reconcileGmailDraft(await input.gmailFor(attempt), attempt)
        : { result: 'NOT_STARTED' as const };
      const saved = await input.store.finish(attempt, result);
      input.report({
        type: saved ? 'DRAFT_RECONCILED' : 'DRAFT_RECONCILIATION_FAILED',
        accountId: attempt.gmailAccountId,
        attemptId: attempt.id,
        reasonCode: saved ? result.result : 'RECONCILIATION_LEASE_LOST',
      });
    } catch {
      // Release the claim when possible; an unavailable database remains leased
      // until expiration. Neither case retries Gmail's create operation.
      await input.store
        .finish(attempt, { result: 'UNAVAILABLE' })
        .catch(() => {});
      input.report({
        type: 'DRAFT_RECONCILIATION_FAILED',
        accountId: attempt.gmailAccountId,
        attemptId: attempt.id,
        reasonCode: 'RECONCILIATION_UNAVAILABLE',
      });
    }
  }
}
