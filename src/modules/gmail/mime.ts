import type { EmailAddress } from './email';
import { DraftWriteError } from './draft-contracts';

export const gmailMimeLimits = Object.freeze({
  recipients: 50,
  subject: 2000,
  body: 6000,
  displayName: 200,
  headerBytes: 32768,
});
export const validMimeAddress = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  value.split('@')[0].length <= 64 &&
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u.test(
    value,
  );
export const validMimeText = (
  value: unknown,
  multiline = false,
): value is string =>
  typeof value === 'string' &&
  value.isWellFormed() &&
  !/[\p{Cc}\p{Cf}]/u.test(
    value.replace(
      multiline ? /[\r\n\t\u200c\u200d]/gu : /[\u200c\u200d]/gu,
      '',
    ),
  );
export const validMimeMailbox = (value: EmailAddress) =>
  !!value &&
  validMimeAddress(value.address) &&
  validMimeText(value.name) &&
  value.name.length <= gmailMimeLimits.displayName;
export const validMimeMessageId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 900 &&
  /^[!-~]+$/u.test(value) &&
  /^<[^<>\s@]+@[^<>\s@]+>$/u.test(value);

// RFC 2047 encoded words never split a UTF-8 code point or exceed 75 octets.
function encodedWords(value: string) {
  const chunks: string[] = [];
  let chunk = '';
  for (const point of value) {
    if (Buffer.byteLength(chunk + point) > 42) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += point;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((v) => `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`);
}
function header(name: string, tokens: string[]) {
  let value = `${name}:`,
    line = value.length;
  for (const token of tokens) {
    const separator = line + token.length + 1 > 78 ? '\r\n ' : ' ';
    value += separator + token;
    line = separator === ' ' ? line + token.length + 1 : token.length + 1;
  }
  return value;
}
function addressTokens(addresses: readonly EmailAddress[]) {
  return addresses.flatMap((a, i) => [
    ...encodedWords(a.name),
    `${a.name ? '<' : ''}${a.address}${a.name ? '>' : ''}${i < addresses.length - 1 ? ',' : ''}`,
  ]);
}
const base64 = (text: string) =>
  Buffer.from(text.replace(/\r\n?|\n/gu, '\r\n'), 'utf8')
    .toString('base64')
    .match(/.{1,76}/gu)!
    .join('\r\n');
export function plainTextToHtml(text: string) {
  if (
    !validMimeText(text, true) ||
    !text.trim() ||
    text.length > gmailMimeLimits.body
  )
    throw new DraftWriteError('INVALID_INPUT');
  const escaped = text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
  return `<html><body><pre dir="auto" style="white-space:pre-wrap;font-family:inherit">${escaped}</pre></body></html>`;
}
export function buildGmailMime(input: {
  from: EmailAddress;
  to: readonly EmailAddress[];
  cc?: readonly EmailAddress[];
  subject: string;
  bodyText: string;
  internetMessageId: string;
  inReplyTo?: string;
  references?: readonly string[];
  now?: Date;
  format?: 'plain' | 'alternative';
  correlationId?: string;
}) {
  const cc = input.cc ?? [],
    references = input.references ?? [],
    now = input.now ?? new Date();
  if (
    !validMimeMailbox(input.from) ||
    !Array.isArray(input.to) ||
    !input.to.length ||
    !Array.isArray(cc) ||
    input.to.length + cc.length > gmailMimeLimits.recipients ||
    ![...input.to, ...cc].every(validMimeMailbox) ||
    !validMimeText(input.subject) ||
    input.subject.length > gmailMimeLimits.subject ||
    !validMimeText(input.bodyText, true) ||
    !input.bodyText.trim() ||
    input.bodyText.length > gmailMimeLimits.body ||
    !validMimeMessageId(input.internetMessageId) ||
    (input.inReplyTo !== undefined && !validMimeMessageId(input.inReplyTo)) ||
    !Array.isArray(references) ||
    references.length > 101 ||
    !references.every(validMimeMessageId) ||
    references.join(' ').length > 8192 ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    (input.format !== undefined &&
      !['plain', 'alternative'].includes(input.format)) ||
    (input.correlationId !== undefined &&
      !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(input.correlationId))
  )
    throw new DraftWriteError('INVALID_INPUT');
  const seen = new Set<string>();
  const unique = (list: readonly EmailAddress[]) =>
    list
      .filter((a) => {
        const key = a.address.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((a) => ({ ...a }));
  const to = unique(input.to),
    copies = unique(cc);
  const headers = [
    header('From', addressTokens([input.from])),
    header('To', addressTokens(to)),
    ...(copies.length ? [header('Cc', addressTokens(copies))] : []),
    header('Subject', encodedWords(input.subject)),
    `Date: ${now.toUTCString()}`,
    `Message-ID: ${input.internetMessageId}`,
    ...(input.inReplyTo ? [header('In-Reply-To', [input.inReplyTo])] : []),
    ...(references.length ? [header('References', [...references])] : []),
    'MIME-Version: 1.0',
    ...(input.correlationId
      ? [`X-Auto-Email-Attempt: ${input.correlationId}`]
      : []),
  ];
  let parts: string[];
  if (input.format === 'alternative') {
    const boundary = `auto_email_${Buffer.from(input.internetMessageId).toString('hex').slice(0, 48)}`;
    parts = [
      'Content-Type: multipart/alternative;',
      ` boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64(input.bodyText),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64(plainTextToHtml(input.bodyText)),
      `--${boundary}--`,
      '',
    ];
  } else
    parts = [
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64(input.bodyText),
      '',
    ];
  if (Buffer.byteLength(headers.join('\r\n')) > gmailMimeLimits.headerBytes)
    throw new DraftWriteError('INVALID_INPUT');
  const mime = [...headers, ...parts].join('\r\n');
  if (mime.split('\r\n').some((line) => Buffer.byteLength(line) > 998))
    throw new DraftWriteError('INVALID_INPUT');
  return {
    raw: Buffer.from(mime, 'utf8').toString('base64url'),
    to,
    cc: copies,
    subject: input.subject,
    references: [...references],
    internetMessageId: input.internetMessageId,
  };
}
