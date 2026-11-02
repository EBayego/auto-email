import { z } from 'zod';
import type { GmailClient, GmailMessage } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { draftEnvelopeFingerprint, draftFingerprint } from './draft-intent';
import { reconciliationAttemptSchema } from './draft-reconciliation';
import { normalizeEmailHeaders, readEmailHeaders } from './email-headers';
import { readEmailBody } from './email-body';
import { parseGmailMessage } from './parser';
import { validMimeMessageId } from './mime';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u);
export const sentTrackingAttemptSchema = reconciliationAttemptSchema.extend({
  status: z.enum(['CREATING', 'CREATED', 'UNCERTAIN', 'CANCELLED']),
  envelopeHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  draftInternetMessageId: z.string().refine(validMimeMessageId).nullable(),
});
export type SentTrackingAttempt = z.infer<typeof sentTrackingAttemptSchema>;
const sentMessage = { messageId: id, sentAt: z.iso.datetime({ offset: true }) };
export const sentTrackingOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('PENDING'),
    reason: z.enum(['NOT_CHECKED', 'DRAFT_PRESENT']),
  }),
  z.strictObject({
    status: z.literal('SENT'),
    reason: z.enum(['MATCHED_MARKER', 'MATCHED_MESSAGE_ID']),
    ...sentMessage,
  }),
  z.strictObject({
    status: z.literal('MANUAL_REPLY'),
    reason: z.literal('SEPARATE_REPLY'),
    ...sentMessage,
  }),
  z.strictObject({
    status: z.literal('INDETERMINATE'),
    reason: z.enum([
      'MISSING_DRAFT',
      'UNCORRELATED_REPLY',
      'AMBIGUOUS',
      'CONTEXT_UNAVAILABLE',
      'INVALID_MESSAGE',
      'UNAVAILABLE',
      'IDENTITY_MISMATCH',
      'DRAFT_STILL_PRESENT',
      'ALREADY_ASSOCIATED',
    ]),
  }),
  z.strictObject({
    status: z.literal('DISCARDED'),
    reason: z.literal('WRITE_CANCELLED'),
  }),
]);
export type SentTrackingOutcome = z.infer<typeof sentTrackingOutcomeSchema>;
export type SentTrackingObservation = {
  outcome: SentTrackingOutcome;
  observedDraftInternetMessageId?: string;
};
const indeterminate = (
  reason: Extract<SentTrackingOutcome, { status: 'INDETERMINATE' }>['reason'],
): SentTrackingObservation => ({
  outcome: { status: 'INDETERMINATE', reason },
});
const metadataHeaders = [
  'From',
  'To',
  'Cc',
  'Bcc',
  'Message-ID',
  'In-Reply-To',
  'References',
  'X-Auto-Email-Attempt',
];
const messageSchema = z
  .object({
    id,
    threadId: id,
    labelIds: z.array(z.string()).max(100).optional(),
    internalDate: z.string().optional(),
  })
  .passthrough();
async function metadata(raw: GmailMessage) {
  messageSchema.parse(raw);
  const warnings = new Set<import('./email').EmailParseWarning>();
  const headers = readEmailHeaders(
    (await readEmailBody(raw, warnings)).headers,
    warnings,
  );
  const normalized = normalizeEmailHeaders(headers, raw.internalDate, warnings);
  if (
    [
      'MALFORMED_HEADERS',
      'DUPLICATE_HEADERS',
      'AMBIGUOUS_FROM',
      'INVALID_ADDRESS',
      'INVALID_MESSAGE_ID',
      'MISSING_MESSAGE_ID',
      'MISSING_FROM',
      'INVALID_DATE',
    ].some((w) => warnings.has(w as import('./email').EmailParseWarning))
  )
    throw new Error('INVALID_MESSAGE');
  return { ...normalized, marker: headers.all('x-auto-email-attempt') };
}

// Poll only processed conversations. No send/update/delete operation exists here.
export async function trackSentGmailDraft(
  gmail: Pick<GmailClient, 'get' | 'getThread' | 'getMessage'>,
  rawAttempt: SentTrackingAttempt,
  now = new Date(),
): Promise<SentTrackingObservation> {
  const attempt = sentTrackingAttemptSchema.parse(rawAttempt);
  if (attempt.status === 'CANCELLED' && !attempt.writeStartedAt)
    return { outcome: { status: 'DISCARDED', reason: 'WRITE_CANCELLED' } };
  if (!attempt.writeStartedAt || !attempt.intent)
    return indeterminate('CONTEXT_UNAVAILABLE');
  const intent = attempt.intent;
  try {
    const readDraft = async () => {
      if (!attempt.draftId) return null;
      try {
        const raw = z.object({ id, message: messageSchema }).parse(
          await gmail.get(`drafts/${attempt.draftId}`, {
            format: 'metadata',
          }),
        );
        if (
          raw.id !== attempt.draftId ||
          raw.message.threadId !== attempt.threadId ||
          !raw.message.labelIds?.includes('DRAFT') ||
          raw.message.labelIds.includes('SENT')
        )
          throw new Error('INVALID_MESSAGE');
        return {
          id: raw.message.id,
          headers: await metadata(raw.message as GmailMessage),
        };
      } catch (error) {
        if (error instanceof ProviderError && error.code === 'NOT_FOUND')
          return null;
        throw error;
      }
    };
    const draft = await readDraft();
    const observedDraftInternetMessageId =
      draft?.headers.internetMessageId ?? undefined;
    const thread = await gmail.getThread(attempt.threadId, {
      format: 'metadata',
      metadataHeaders,
    });
    if (
      thread.id !== attempt.threadId ||
      !thread.messages.length ||
      thread.messages.length > 100 ||
      new Set(thread.messages.map((m) => m.id)).size !==
        thread.messages.length ||
      thread.messages.some((m) => m.threadId !== attempt.threadId)
    )
      return indeterminate('INVALID_MESSAGE');
    const target = thread.messages.find(
      (m) => m.id === attempt.targetMessageId,
    );
    if (!target || target.labelIds?.some((l) => ['SENT', 'DRAFT'].includes(l)))
      return indeterminate('CONTEXT_UNAVAILABLE');
    const targetHeaders = await metadata(target);
    if (
      targetHeaders.internetMessageId !== intent.inReplyTo ||
      !targetHeaders.receivedAt
    )
      return indeterminate('CONTEXT_UNAVAILABLE');
    const floor = Math.max(
      Date.parse(targetHeaders.receivedAt),
      Math.floor(Date.parse(attempt.writeStartedAt) / 1000) * 1000,
    );
    const matching: Extract<SentTrackingOutcome, { status: 'SENT' }>[] = [];
    const other: Extract<SentTrackingOutcome, { status: 'MANUAL_REPLY' }>[] =
      [];
    let uncorrelated = false;
    for (const raw of thread.messages.filter((m) =>
      m.labelIds?.includes('SENT'),
    )) {
      if (raw.labelIds?.includes('DRAFT'))
        return indeterminate('INVALID_MESSAGE');
      const h = await metadata(raw);
      if (
        !h.receivedAt ||
        Date.parse(h.receivedAt) < floor ||
        Date.parse(h.receivedAt) > now.getTime() + 60000
      )
        continue;
      const ownMarker = h.marker.length === 1 && h.marker[0] === attempt.id;
      const ownId =
        !!h.internetMessageId &&
        [
          intent.internetMessageId,
          attempt.draftInternetMessageId,
          observedDraftInternetMessageId,
        ].includes(h.internetMessageId);
      if (h.marker.length > 1 || (ownId && h.marker.length && !ownMarker))
        return indeterminate('AMBIGUOUS');
      if (h.inReplyTo.length !== 1 || h.inReplyTo[0] !== intent.inReplyTo) {
        if (ownMarker || ownId) return indeterminate('IDENTITY_MISMATCH');
        continue;
      }
      let envelopeMatches =
        attempt.envelopeHash !== null &&
        draftEnvelopeFingerprint(h) === attempt.envelopeHash;
      // Legacy generations have only a full fingerprint. Compare it transiently;
      // content similarity alone never establishes which draft was sent.
      if (!attempt.envelopeHash && (ownMarker || ownId)) {
        const full = await gmail.getMessage(raw.id, { format: 'full' });
        if (
          full.id !== raw.id ||
          full.threadId !== attempt.threadId ||
          !full.labelIds?.includes('SENT') ||
          full.labelIds.includes('DRAFT')
        )
          return indeterminate('INVALID_MESSAGE');
        const parsed = await parseGmailMessage(full);
        const fresh = await metadata(full);
        if (
          fresh.internetMessageId !== h.internetMessageId ||
          JSON.stringify(fresh.marker) !== JSON.stringify(h.marker) ||
          fresh.receivedAt !== h.receivedAt
        )
          return indeterminate('INVALID_MESSAGE');
        envelopeMatches =
          parsed.bodyStatus === 'complete' &&
          !parsed.bcc.length &&
          !parsed.attachments.length &&
          draftFingerprint(parsed) === intent.fingerprint;
      }
      if (!envelopeMatches) {
        if (ownMarker || ownId) return indeterminate('IDENTITY_MISMATCH');
        uncorrelated = true;
        continue;
      }
      if (ownMarker || ownId)
        matching.push({
          status: 'SENT',
          reason: ownMarker ? 'MATCHED_MARKER' : 'MATCHED_MESSAGE_ID',
          messageId: raw.id,
          sentAt: h.receivedAt,
        });
      else if (
        !h.marker.length &&
        !h.internetMessageId?.startsWith('<mail021.')
      )
        other.push({
          status: 'MANUAL_REPLY',
          reason: 'SEPARATE_REPLY',
          messageId: raw.id,
          sentAt: h.receivedAt,
        });
      else uncorrelated = true;
    }
    if (matching.length > 1) return indeterminate('AMBIGUOUS');
    if (matching.length) {
      if (draft && (await readDraft()))
        return indeterminate('DRAFT_STILL_PRESENT');
      return { outcome: matching[0] };
    }
    if (other.length || uncorrelated) {
      if (
        other.length === 1 &&
        !uncorrelated &&
        draft &&
        attempt.envelopeHash &&
        draftEnvelopeFingerprint(draft.headers) === attempt.envelopeHash
      ) {
        const fresh = await readDraft();
        if (
          fresh &&
          fresh.headers.internetMessageId === draft.headers.internetMessageId &&
          draftEnvelopeFingerprint(fresh.headers) === attempt.envelopeHash
        )
          return { outcome: other[0], observedDraftInternetMessageId };
      }
      return indeterminate(
        other.length > 1 ? 'AMBIGUOUS' : 'UNCORRELATED_REPLY',
      );
    }
    return draft
      ? {
          outcome: { status: 'PENDING', reason: 'DRAFT_PRESENT' },
          observedDraftInternetMessageId,
        }
      : indeterminate('MISSING_DRAFT');
  } catch (error) {
    return indeterminate(
      error instanceof ProviderError ? 'UNAVAILABLE' : 'INVALID_MESSAGE',
    );
  }
}
