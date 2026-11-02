import type { GmailClient } from '@/providers/contracts';
import {
  trackSentGmailDraft,
  type SentTrackingAttempt,
  type SentTrackingObservation,
} from '@/modules/gmail/sent-draft-tracking';
export type SentTrackingEvent = {
  type: 'SENT_DRAFT_CHECKED' | 'SENT_DRAFT_CHECK_FAILED';
  accountId: string;
  attemptId: string;
  reasonCode: string;
};
export async function runSentDraftTracking(
  input: {
    store: {
      claim(limit: number): Promise<SentTrackingAttempt[]>;
      finish(
        attempt: SentTrackingAttempt,
        result: SentTrackingObservation,
      ): Promise<boolean>;
    };
    gmailFor(
      attempt: SentTrackingAttempt,
    ): Promise<Pick<GmailClient, 'get' | 'getThread' | 'getMessage'>>;
    report(event: SentTrackingEvent): void;
  },
  limit: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return;
  for (const attempt of await input.store.claim(Math.min(limit, 100))) {
    if (signal?.aborted) break;
    try {
      const result: SentTrackingObservation =
        attempt.status === 'CANCELLED' && !attempt.writeStartedAt
          ? { outcome: { status: 'DISCARDED', reason: 'WRITE_CANCELLED' } }
          : await trackSentGmailDraft(await input.gmailFor(attempt), attempt);
      const saved = await input.store.finish(attempt, result);
      input.report({
        type: saved ? 'SENT_DRAFT_CHECKED' : 'SENT_DRAFT_CHECK_FAILED',
        accountId: attempt.gmailAccountId,
        attemptId: attempt.id,
        reasonCode: saved ? 'TRACKING_RESULT_SAVED' : 'TRACKING_LEASE_LOST',
      });
    } catch {
      await input.store
        .finish(attempt, {
          outcome: { status: 'INDETERMINATE', reason: 'UNAVAILABLE' },
        })
        .catch(() => {});
      input.report({
        type: 'SENT_DRAFT_CHECK_FAILED',
        accountId: attempt.gmailAccountId,
        attemptId: attempt.id,
        reasonCode: 'UNAVAILABLE',
      });
    }
  }
}
