import type { GmailMessage } from '@/providers/contracts';
import type { EmailHeader } from '@/modules/gmail/email';
import { createEmailFixtures } from './emails';

export function classifierMessage(
  options: {
    text?: string;
    subject?: string;
    from?: string;
    to?: string;
    cc?: string;
    replyTo?: string;
    labels?: readonly string[];
    headers?: readonly EmailHeader[];
  } = {},
): GmailMessage {
  const base = createEmailFixtures().pending.messages[0];
  const text =
    options.text ?? 'Hola, ¿puedes enviarme el horario de atención? Gracias.';
  return {
    ...base,
    labelIds: [...(options.labels ?? ['INBOX'])],
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: options.from ?? 'contact@example.invalid' },
        { name: 'To', value: options.to ?? 'owner@example.invalid' },
        {
          name: 'Subject',
          value: options.subject ?? 'Consulta sobre el horario',
        },
        { name: 'Message-ID', value: '<classifier@example.invalid>' },
        { name: 'Date', value: 'Tue, 20 Oct 2026 10:00:00 +0000' },
        ...(options.cc ? [{ name: 'Cc', value: options.cc }] : []),
        ...(options.replyTo
          ? [{ name: 'Reply-To', value: options.replyTo }]
          : []),
        ...(options.headers ?? []),
      ],
      body: {
        size: Buffer.byteLength(text),
        data: Buffer.from(text).toString('base64url'),
      },
    },
  };
}

export function classifierMetadata(full: GmailMessage): GmailMessage {
  return {
    id: full.id,
    threadId: full.threadId,
    internalDate: full.internalDate,
    labelIds: full.labelIds,
    payload: {
      mimeType: full.payload?.mimeType,
      headers: full.payload?.headers,
      body: { size: 0 },
    },
  };
}
