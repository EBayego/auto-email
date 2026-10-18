import type { PreparedReplyContext } from './manual-selection';
import { DraftWriteError } from './draft-contracts';

const mailbox = (value: string) =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(
    value,
  );
const messageId = (value: string) =>
  typeof value === 'string' &&
  value.length <= 900 &&
  /^[!-~]+$/.test(value) &&
  /^<[^<>\s@]+@[^<>\s@]+>$/.test(value);

// RFC 2047 words stay below 75 octets and never split a UTF-8 code point.
function encodedSubject(value: string) {
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
  return chunks
    .map((item) => `=?UTF-8?B?${Buffer.from(item).toString('base64')}?=`)
    .join('\r\n ');
}
function referenceHeader(ids: string[]) {
  let value = 'References:';
  let line = value.length;
  for (const id of ids) {
    const separator = line + id.length + 1 > 78 ? '\r\n ' : ' ';
    value += separator + id;
    line = separator === ' ' ? line + 1 + id.length : 1 + id.length;
  }
  return value;
}
export function buildReplyMime(input: {
  from: string;
  target: PreparedReplyContext['replyTarget'];
  bodyText: string;
  attemptId: string;
  now?: Date;
}) {
  const { target } = input;
  const subject = target?.subject ?? '';
  const now = input.now ?? new Date();
  if (
    !target ||
    !mailbox(input.from) ||
    !mailbox(target.to?.address) ||
    typeof subject !== 'string' ||
    subject.length > 2000 ||
    /[\p{Cc}\p{Cf}]/u.test(subject) ||
    !messageId(target.inReplyTo) ||
    !Array.isArray(target.references) ||
    target.references.length > 100 ||
    !target.references.every(messageId) ||
    typeof input.bodyText !== 'string' ||
    !input.bodyText.trim() ||
    input.bodyText.length > 6000 ||
    /[\p{Cc}\p{Cf}]/u.test(input.bodyText.replace(/[\r\n\t]/g, '')) ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.attemptId) ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  )
    throw new DraftWriteError('INVALID_INPUT');
  const references = [
    ...new Set([
      ...target.references.filter((id) => id !== target.inReplyTo),
      target.inReplyTo,
    ]),
  ];
  if (references.join(' ').length > 8192)
    throw new DraftWriteError('INVALID_INPUT');
  const internetMessageId = `<mail021.${input.attemptId}@auto-email.invalid>`;
  const text = input.bodyText.replace(/\r\n|\r|\n/g, '\r\n');
  const body = Buffer.from(text, 'utf8')
    .toString('base64')
    .match(/.{1,76}/g)!
    .join('\r\n');
  // Keep the original subject exactly, as required for Gmail threading.
  const mime = [
    `From: ${input.from}`,
    `To: ${target.to.address}`,
    `Subject: ${encodedSubject(subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: ${internetMessageId}`,
    `In-Reply-To: ${target.inReplyTo}`,
    referenceHeader(references),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ].join('\r\n');
  return {
    raw: Buffer.from(mime, 'utf8').toString('base64url'),
    subject,
    references,
    internetMessageId,
  };
}
