import { z } from 'zod';
import type { GmailClient, GmailMessage } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { draftFingerprint, draftIntentSchema } from './draft-intent';
import { parseGmailMessage } from './parser';
import { readEmailHeaders } from './email-headers';
import { readEmailBody } from './email-body';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u);
export const reconciliationAttemptSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  gmailAccountId: z.uuid(),
  threadId: id,
  targetMessageId: id,
  draftId: id.nullable(),
  writeStartedAt: z.iso.datetime({ offset: true }).nullable(),
  leaseId: z.uuid(),
  intent: draftIntentSchema.nullable(),
});
export type ReconciliationAttempt = z.infer<typeof reconciliationAttemptSchema>;
export type ReconciliationResult =
  | { result: 'FOUND' | 'EDITED'; draftId: string; messageId: string }
  | {
      result:
        'MISSING' | 'AMBIGUOUS' | 'UNAVAILABLE' | 'NOT_STARTED' | 'UNCONFIRMED';
    };
const envelope = z.object({
  id,
  message: z.object({ id, threadId: id }).passthrough(),
});
const page = z.object({
  drafts: z.array(envelope).max(100).default([]),
  nextPageToken: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[\x21-\x7e]+$/u)
    .optional(),
});

// Read-only recovery: even missing or edited drafts never authorize another POST.
export async function reconcileGmailDraft(
  gmail: Pick<GmailClient, 'get'>,
  rawAttempt: ReconciliationAttempt,
): Promise<ReconciliationResult> {
  const attempt = reconciliationAttemptSchema.parse(rawAttempt);
  if (!attempt.writeStartedAt) return { result: 'NOT_STARTED' };
  const inspect = async (raw: unknown, known: boolean) => {
    const draft = envelope.parse(raw);
    if (draft.message.threadId !== attempt.threadId) return null;
    const message = await parseGmailMessage(draft.message as GmailMessage);
    if (!message.labels.includes('DRAFT') || message.labels.includes('SENT'))
      return null;
    const correlation = readEmailHeaders(
      (await readEmailBody(draft.message as GmailMessage, new Set())).headers,
      new Set(),
    ).all('x-auto-email-attempt');
    // Full responses provide MIME headers. A retained stable draft ID establishes
    // ownership after a user edit; a new ID requires the stored random marker.
    const marker = correlation.length === 1 && correlation[0] === attempt.id;
    const exact =
      !!attempt.intent &&
      message.bodyStatus === 'complete' &&
      !message.bcc.length &&
      !message.attachments.length &&
      message.inReplyTo.length === 1 &&
      message.inReplyTo[0] === attempt.intent.inReplyTo &&
      draftFingerprint(message) === attempt.intent.fingerprint;
    if (!known && !(marker && exact)) return null;
    return {
      result: exact ? ('FOUND' as const) : ('EDITED' as const),
      draftId: draft.id,
      messageId: message.id,
    };
  };
  if (attempt.draftId) {
    try {
      const raw = await gmail.get(`drafts/${attempt.draftId}`, {
        format: 'full',
      });
      const parsed = envelope.parse(raw);
      if (parsed.id !== attempt.draftId) return { result: 'UNAVAILABLE' };
      return (await inspect(raw, true)) ?? { result: 'UNCONFIRMED' };
    } catch (error) {
      return {
        result:
          error instanceof ProviderError && error.code === 'NOT_FOUND'
            ? 'MISSING'
            : 'UNAVAILABLE',
      };
    }
  }
  if (!attempt.intent) return { result: 'UNCONFIRMED' };
  try {
    const found: Extract<ReconciliationResult, { draftId: string }>[] = [];
    const seen = new Set<string>(),
      cursors = new Set<string>();
    let inspected = 0;
    let cursor: string | undefined;
    for (let n = 0; n < 5; n++) {
      const listing = page.parse(
        await gmail.get('drafts', {
          maxResults: 100,
          ...(cursor ? { pageToken: cursor } : {}),
        }),
      );
      for (const draft of listing.drafts) {
        if (seen.has(draft.id)) return { result: 'UNAVAILABLE' };
        seen.add(draft.id);
        if (draft.message.threadId !== attempt.threadId) continue;
        if (++inspected > 20) return { result: 'UNCONFIRMED' };
        try {
          const raw = await gmail.get(`drafts/${draft.id}`, { format: 'full' });
          if (envelope.parse(raw).id !== draft.id)
            return { result: 'UNAVAILABLE' };
          const match = await inspect(raw, false);
          if (match) found.push(match);
        } catch (error) {
          if (!(error instanceof ProviderError && error.code === 'NOT_FOUND'))
            throw error;
        }
      }
      if (found.length > 1) return { result: 'AMBIGUOUS' };
      if (!listing.nextPageToken) return found[0] ?? { result: 'MISSING' };
      if (cursors.has(listing.nextPageToken)) return { result: 'UNAVAILABLE' };
      cursors.add(listing.nextPageToken);
      cursor = listing.nextPageToken;
    }
    return { result: 'UNCONFIRMED' };
  } catch {
    return { result: 'UNAVAILABLE' };
  }
}
