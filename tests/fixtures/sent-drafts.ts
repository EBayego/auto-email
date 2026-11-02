import { vi } from 'vitest';
import type { GmailClient, GmailMessage } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import {
  draftEnvelopeFingerprint,
  draftFingerprint,
} from '@/modules/gmail/draft-intent';
import type { SentTrackingAttempt } from '@/modules/gmail/sent-draft-tracking';
export function withSentHeader(
  message: GmailMessage,
  name: string,
  value: string | null,
): GmailMessage {
  return {
    ...message,
    payload: {
      ...message.payload,
      headers: [
        ...(message.payload?.headers ?? []).filter(
          (h) => h.name.toLowerCase() !== name.toLowerCase(),
        ),
        ...(value === null ? [] : [{ name, value }]),
      ],
    },
  };
}
export function sentDraftFixture() {
  const id = crypto.randomUUID(),
    writeAt = Date.now() - 300000;
  const body = 'Hola. Confirmo que he recibido tu mensaje. Un saludo.';
  const headers = [
    { name: 'From', value: 'owner@example.invalid' },
    { name: 'To', value: 'contact@example.invalid' },
    { name: 'Subject', value: 'Consulta' },
    { name: 'Message-ID', value: '<gmail-draft57@example.invalid>' },
    { name: 'In-Reply-To', value: '<incoming57@example.invalid>' },
    { name: 'X-Auto-Email-Attempt', value: id },
  ];
  const sent: GmailMessage = {
    id: 'sent57',
    threadId: 'thread57',
    labelIds: ['SENT'],
    internalDate: String(writeAt + 60000),
    payload: {
      mimeType: 'text/plain',
      headers,
      body: {
        data: Buffer.from(body).toString('base64url'),
        size: body.length,
      },
    },
  };
  const target = withSentHeader(
    withSentHeader(
      withSentHeader(
        withSentHeader(sent, 'From', 'contact@example.invalid'),
        'To',
        'owner@example.invalid',
      ),
      'Message-ID',
      '<incoming57@example.invalid>',
    ),
    'In-Reply-To',
    null,
  );
  const incoming: GmailMessage = {
    ...withSentHeader(target, 'X-Auto-Email-Attempt', null),
    id: 'incoming57',
    labelIds: ['INBOX'],
    internalDate: String(writeAt - 60000),
  };
  const envelope = {
    from: [{ name: '', address: 'owner@example.invalid' }],
    to: [{ name: '', address: 'contact@example.invalid' }],
    cc: [],
  };
  const attempt: SentTrackingAttempt = {
    id,
    userId: crypto.randomUUID(),
    gmailAccountId: crypto.randomUUID(),
    threadId: sent.threadId,
    targetMessageId: incoming.id,
    draftId: 'draft57',
    status: 'CREATED',
    writeStartedAt: new Date(writeAt).toISOString(),
    leaseId: crypto.randomUUID(),
    envelopeHash: draftEnvelopeFingerprint(envelope),
    draftInternetMessageId: '<gmail-draft57@example.invalid>',
    intent: {
      version: 'mail048-v1',
      internetMessageId: `<mail021.${id}@auto-email.invalid>`,
      inReplyTo: '<incoming57@example.invalid>',
      fingerprint: draftFingerprint({
        ...envelope,
        subject: 'Consulta',
        inReplyTo: ['<incoming57@example.invalid>'],
        bodyText: body,
      }),
    },
  };
  const state = {
    draftPresent: false,
    sent: [sent],
    draft: {
      id: 'draft57',
      message: {
        ...sent,
        id: 'draftMessage57',
        labelIds: ['DRAFT'],
        internalDate: String(writeAt + 1000),
      },
    },
  };
  const gmail = {
    get: vi.fn<GmailClient['get']>(async () => {
      if (!state.draftPresent) throw new ProviderError('google', 'NOT_FOUND');
      return state.draft;
    }),
    getThread: vi.fn<GmailClient['getThread']>(async () => ({
      id: 'thread57',
      messages: [incoming, ...state.sent],
    })),
    getMessage: vi.fn<GmailClient['getMessage']>(async (id) =>
      state.sent.find((m) => m.id === id)!,
    ),
  };
  return { attempt, gmail, state, sent, incoming, body, writeAt };
}
