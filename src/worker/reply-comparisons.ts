import type { GmailClient } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { parseGmailMessage } from '@/modules/gmail/parser';
import { readEmailBody } from '@/modules/gmail/email-body';
import { readEmailHeaders } from '@/modules/gmail/email-headers';
import {
  draftEnvelopeFingerprint,
  draftFingerprint,
} from '@/modules/gmail/draft-intent';
import {
  compareReplies,
  ReplyComparisonError,
} from '@/modules/analytics/reply-comparison';
import type {
  ComparisonResolution,
  ReplyComparisonStore,
  ReplyComparisonTask,
} from '@/modules/analytics/comparison-work';
export type ReplyComparisonEvent = {
  type: 'REPLY_COMPARISON_SAVED' | 'REPLY_COMPARISON_FAILED';
  accountId: string;
  feedbackId: string;
  reasonCode: string;
};
export async function compareSentReply(
  gmail: Pick<GmailClient, 'getMessage'>,
  task: ReplyComparisonTask,
  original: string,
): Promise<ComparisonResolution> {
  try {
    const raw = await gmail.getMessage(task.sentMessageId, { format: 'full' });
    if (
      raw.id !== task.sentMessageId ||
      raw.threadId !== task.threadId ||
      !raw.labelIds?.includes('SENT') ||
      raw.labelIds.includes('DRAFT') ||
      !task.intent
    )
      return { status: 'SKIPPED', reason: 'IDENTITY_CHANGED' };
    const parsed = await parseGmailMessage(raw);
    const marker = readEmailHeaders(
      (await readEmailBody(raw, new Set())).headers,
      new Set(),
    ).all('x-auto-email-attempt');
    if (
      !parsed.receivedAt ||
      Date.parse(parsed.receivedAt) !== Date.parse(task.sentAt) ||
      parsed.inReplyTo.length !== 1 ||
      parsed.inReplyTo[0] !== task.intent.inReplyTo ||
      !parsed.internetMessageId ||
      marker.length > 1 ||
      (marker.length && marker[0] !== task.draftGenerationId) ||
      !(
        marker[0] === task.draftGenerationId ||
        [task.intent.internetMessageId, task.draftInternetMessageId].includes(
          parsed.internetMessageId,
        )
      ) ||
      (task.envelopeHash
        ? draftEnvelopeFingerprint(parsed) !== task.envelopeHash
        : draftFingerprint(parsed) !== task.intent.fingerprint)
    )
      return { status: 'SKIPPED', reason: 'IDENTITY_CHANGED' };
    if (
      parsed.bodyStatus !== 'complete' ||
      parsed.warnings.some((warning) =>
        [
          'MALFORMED_HEADERS',
          'DUPLICATE_HEADERS',
          'AMBIGUOUS_FROM',
          'INVALID_ADDRESS',
          'AMBIGUOUS_QUOTE',
        ].includes(warning),
      )
    )
      return { status: 'SKIPPED', reason: 'UNSUPPORTED_CONTENT' };
    // Keep the user's signature and remove only quoted conversation history.
    const sent = parsed.segments
      .filter((segment) => segment.kind !== 'quoted')
      .map((segment) => segment.text)
      .join('\n\n');
    return {
      status: 'COMPLETED',
      metrics: compareReplies(original, sent, {
        attachmentsChanged: parsed.attachments.some(
          (attachment) => !attachment.inline,
        ),
      }),
    };
  } catch (error) {
    if (error instanceof ReplyComparisonError)
      return { status: 'SKIPPED', reason: error.code };
    if (error instanceof ProviderError)
      return error.code === 'NOT_FOUND'
        ? { status: 'SKIPPED', reason: 'INVALID_MESSAGE' }
        : { status: 'RETRY', reason: 'SENT_UNAVAILABLE' };
    return { status: 'SKIPPED', reason: 'UNSUPPORTED_CONTENT' };
  }
}
export async function runReplyComparisons(
  input: {
    store: ReplyComparisonStore;
    gmailFor(
      task: ReplyComparisonTask,
    ): Promise<Pick<GmailClient, 'getMessage'>>;
    report(event: ReplyComparisonEvent): void;
  },
  limit: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted) return;
  for (const task of await input.store.claim(Math.min(limit, 100))) {
    if (signal?.aborted) break;
    try {
      let result: ComparisonResolution;
      let original: string | null = null;
      try {
        original = await input.store.loadOriginal(task);
        if (!original)
          result = { status: 'SKIPPED', reason: 'ORIGINAL_UNAVAILABLE' };
        else if (task.attempts > 5)
          result = { status: 'SKIPPED', reason: 'RETRY_LIMIT' };
        else if (signal?.aborted) break;
        else
          result = await compareSentReply(
            await input.gmailFor(task),
            task,
            original,
          );
      } finally {
        original = null;
      }
      const saved = await input.store.finish(task, result);
      input.report({
        type: saved ? 'REPLY_COMPARISON_SAVED' : 'REPLY_COMPARISON_FAILED',
        accountId: task.gmailAccountId,
        feedbackId: task.id,
        reasonCode: saved ? 'COMPARISON_RESULT_SAVED' : 'COMPARISON_LEASE_LOST',
      });
    } catch {
      await input.store
        .finish(task, { status: 'RETRY', reason: 'SENT_UNAVAILABLE' })
        .catch(() => {});
      input.report({
        type: 'REPLY_COMPARISON_FAILED',
        accountId: task.gmailAccountId,
        feedbackId: task.id,
        reasonCode: 'UNAVAILABLE',
      });
    }
  }
}
