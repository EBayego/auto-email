import { vi } from 'vitest';
import type {
  GmailClient,
  GmailMessage,
  GmailMessagePart,
} from '@/providers/contracts';

export const sampleNow = new Date('2026-10-18T12:00:00Z');
export const sampleOwner = 'owner@example.invalid';
export function sentEmail(
  index: number,
  changes: Partial<GmailMessage> = {},
  text?: string,
): GmailMessage {
  const id = `sent${index}`;
  const body =
    text ??
    `Hola, he revisado la propuesta del proyecto ${index} y podemos continuar con los siguientes pasos. Gracias por tu ayuda.`;
  return {
    id,
    threadId: `thread${index}`,
    labelIds: ['SENT'],
    internalDate: String(
      new Date('2026-08-01T12:00:00Z').getTime() - index * 86400000,
    ),
    sizeEstimate: 1024,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: sampleOwner },
        { name: 'To', value: `contact${index % 10}@example.invalid` },
        { name: 'Subject', value: 'Propuesta del proyecto' },
        { name: 'Message-ID', value: `<${id}@example.invalid>` },
      ],
      body: { data: Buffer.from(body).toString('base64url') },
    },
    ...changes,
  };
}
export function withHeaders(
  email: GmailMessage,
  headers: Record<string, string>,
): GmailMessage {
  const replacements = new Set(
    Object.keys(headers).map((key) => key.toLowerCase()),
  );
  return {
    ...email,
    payload: {
      ...email.payload,
      headers: [
        ...(email.payload?.headers ?? []).filter(
          ({ name }) => !replacements.has(name.toLowerCase()),
        ),
        ...Object.entries(headers).map(([name, value]) => ({ name, value })),
      ],
    },
  };
}
export function sentMailbox(messages: GmailMessage[]) {
  const metadata = (part: GmailMessagePart): GmailMessagePart => ({
    mimeType: part.mimeType,
    headers: part.headers,
  });
  const listMessages = vi.fn<GmailClient['listMessages']>(
    async (options = {}) => {
      const eligible = messages.filter(
        (message) =>
          Number(message.internalDate) > options.after!.getTime() &&
          Number(message.internalDate) < options.before!.getTime(),
      );
      const start = Number(options.pageToken ?? 0);
      const limit = options.maxResults ?? 25;
      return {
        messages: eligible
          .slice(start, start + limit)
          .map(({ id, threadId }) => ({ id, threadId })),
        ...(start + limit < eligible.length
          ? { nextPageToken: String(start + limit) }
          : {}),
      };
    },
  );
  const getMessage = vi.fn<GmailClient['getMessage']>(async (id, options) => {
    const email = messages.find((message) => message.id === id)!;
    return options?.format === 'metadata'
      ? {
          ...email,
          payload: email.payload ? metadata(email.payload) : undefined,
        }
      : email;
  });
  return { listMessages, getMessage };
}
