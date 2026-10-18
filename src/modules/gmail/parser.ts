import type { GmailClient, GmailMessage } from '@/providers/contracts';
import {
  EmailParseError,
  type EmailWarnings,
  type NormalizedEmail,
} from './email';
import { normalizeEmailHeaders, readEmailHeaders } from './email-headers';
import { readEmailBody } from './email-body';
import {
  normalizeEmailText,
  segmentHtml,
  segmentPlainText,
} from './email-content';

export { EmailParseError } from './email';
export type {
  NormalizedEmail,
  EmailAddress,
  EmailAttachment,
  EmailSegment,
  EmailParseWarning,
} from './email';

export async function parseGmailMessage(
  message: GmailMessage,
  options: { retainOriginal?: boolean } = {},
): Promise<NormalizedEmail> {
  try {
    return await normalizeGmailMessage(message, options);
  } catch (error) {
    if (error instanceof EmailParseError) throw error;
    throw new EmailParseError('INVALID_MIME');
  }
}

async function normalizeGmailMessage(
  message: GmailMessage,
  options: { retainOriginal?: boolean },
): Promise<NormalizedEmail> {
  if (
    !message ||
    typeof message.id !== 'string' ||
    typeof message.threadId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,512}$/.test(message.id) ||
    !/^[A-Za-z0-9_-]{1,512}$/.test(message.threadId) ||
    (message.labelIds !== undefined &&
      (!Array.isArray(message.labelIds) ||
        message.labelIds.some((label) => typeof label !== 'string')))
  )
    throw new EmailParseError('INVALID_MESSAGE');
  const warnings: EmailWarnings = new Set();
  const { headers, bodies, attachments } = await readEmailBody(
    message,
    warnings,
  );
  const metadata = normalizeEmailHeaders(
    readEmailHeaders(headers, warnings),
    message.internalDate,
    warnings,
  );
  const segments = bodies.flatMap((body) => {
    // HTML has structural quote/signature boundaries that plain alternatives often lose.
    const html = body.html ? segmentHtml(body.html, warnings) : [];
    return html.length ? html : segmentPlainText(body.text ?? '', warnings);
  });
  const bodyText = normalizeEmailText(
    segments.map((segment) => segment.text).join('\n\n'),
  );
  const authoredText = normalizeEmailText(
    segments
      .filter((segment) => segment.kind === 'authored')
      .map((segment) => segment.text)
      .join('\n\n'),
  );
  const incomplete = (
    [
      'BODY_NOT_LOADED',
      'UNSUPPORTED_BODY',
      'INVALID_BASE64',
      'INVALID_TEXT_ENCODING',
      'UNSUPPORTED_CHARSET',
      'ASSUMED_CHARSET',
    ] as const
  ).some((code) => warnings.has(code));
  return {
    id: message.id,
    threadId: message.threadId,
    labels: [...(message.labelIds ?? [])],
    ...metadata,
    bodyText,
    authoredText,
    segments,
    bodyStatus: incomplete ? 'incomplete' : bodyText ? 'complete' : 'empty',
    isEmpty: !incomplete && !bodyText,
    hasAttachments: attachments.length > 0,
    attachments,
    warnings: [...warnings],
    ...(options.retainOriginal ? { original: message } : {}),
  };
}

export async function getNormalizedMessage(
  client: Pick<GmailClient, 'getMessage'>,
  id: string,
  options: { retainOriginal?: boolean } = {},
): Promise<NormalizedEmail> {
  return parseGmailMessage(
    await client.getMessage(id, { format: 'full' }),
    options,
  );
}
