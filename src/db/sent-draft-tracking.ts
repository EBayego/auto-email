import type { DataClient } from './models';
import type { Json } from './database.types';
import { DataAccessError } from './errors';
import { enforcePrivacyConfiguration } from './privacy';
import {
  sentTrackingAttemptSchema,
  sentTrackingOutcomeSchema,
  type SentTrackingAttempt,
  type SentTrackingObservation,
} from '@/modules/gmail/sent-draft-tracking';
export function createSentDraftTrackingStore(client: DataClient) {
  return Object.freeze({
    async claim(limit: number): Promise<SentTrackingAttempt[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new DataAccessError('INVALID_INPUT');
      await enforcePrivacyConfiguration(client);
      const { data, error } = await client.rpc('claim_sent_draft_tracking', {
        p_limit: limit,
        p_lease_seconds: 120,
      });
      if (error || !data || data.length > limit)
        throw new DataAccessError('UNAVAILABLE');
      return data.map((row) => {
        const parsed = sentTrackingAttemptSchema.safeParse({
          id: row.id,
          userId: row.user_id,
          gmailAccountId: row.gmail_account_id,
          threadId: row.thread_id,
          targetMessageId: row.target_message_id,
          status: row.status,
          draftId: row.draft_id,
          writeStartedAt: row.write_started_at,
          leaseId: row.sent_lease_id,
          intent: row.delivery_intent,
          envelopeHash: row.delivery_envelope_hash,
          draftInternetMessageId: row.draft_internet_message_id,
        });
        if (!parsed.success) throw new DataAccessError('UNAVAILABLE');
        return parsed.data;
      });
    },
    async finish(
      rawAttempt: SentTrackingAttempt,
      observation: SentTrackingObservation,
    ): Promise<boolean> {
      const attempt = sentTrackingAttemptSchema.safeParse(rawAttempt),
        outcome = sentTrackingOutcomeSchema.safeParse(observation.outcome);
      if (!attempt.success || !outcome.success)
        throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client.rpc('finish_sent_draft_tracking', {
        p_user_id: attempt.data.userId,
        p_account_id: attempt.data.gmailAccountId,
        p_attempt_id: attempt.data.id,
        p_lease_id: attempt.data.leaseId,
        p_outcome: outcome.data as Json,
        p_draft_internet_message_id: observation.observedDraftInternetMessageId,
      });
      if (error || typeof data !== 'boolean')
        throw new DataAccessError('UNAVAILABLE');
      return data;
    },
  });
}
