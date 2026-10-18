import { addressParser, decodeWords } from 'postal-mime';
import {
  emailLimits,
  EmailParseError,
  type EmailAddress,
  type EmailHeader,
  type EmailWarnings,
} from './email';

export function readEmailHeaders(
  input: readonly EmailHeader[] = [],
  warnings: EmailWarnings,
) {
  const values = new Map<string, string[]>();
  let bytes = 0;
  for (const header of input) {
    if (
      !header ||
      typeof header.name !== 'string' ||
      typeof header.value !== 'string'
    ) {
      warnings.add('MALFORMED_HEADERS');
      continue;
    }
    bytes +=
      Buffer.byteLength(header.name) + Buffer.byteLength(header.value) + 64;
    if (bytes > emailLimits.headerBytes)
      throw new EmailParseError('LIMIT_EXCEEDED');
    const value = header.value
      .replace(/\r?\n[\t ]+/g, ' ')
      .replace(/\t/g, ' ')
      .trim();
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(header.name) || /\p{Cc}/u.test(value)) {
      warnings.add('MALFORMED_HEADERS');
      continue;
    }
    const name = header.name.toLowerCase();
    const previous = values.get(name) ?? [];
    if (
      previous.length &&
      [
        'from',
        'subject',
        'date',
        'message-id',
        'in-reply-to',
        'content-type',
        'content-disposition',
      ].includes(name)
    )
      warnings.add('DUPLICATE_HEADERS');
    values.set(name, [...previous, value]);
  }
  return {
    all: (name: string) => values.get(name) ?? [],
    first: (name: string) => values.get(name)?.[0],
  };
}
export type EmailHeaders = ReturnType<typeof readEmailHeaders>;

export function decodeHeader(value: string, warnings: EmailWarnings): string {
  try {
    const decoded = decodeWords(value);
    if (/\p{Cc}/u.test(decoded) || /=\?[^?]*\?/.test(decoded)) {
      warnings.add('MALFORMED_HEADERS');
      return decoded.replace(/\p{Cc}/gu, ' ');
    }
    return decoded;
  } catch {
    warnings.add('MALFORMED_HEADERS');
    return value;
  }
}

function addresses(
  headers: EmailHeaders,
  name: string,
  warnings: EmailWarnings,
): EmailAddress[] {
  const result: EmailAddress[] = [];
  for (const value of headers.all(name)) {
    try {
      const parsed = addressParser(value, { flatten: true });
      if (!parsed.length && value) warnings.add('INVALID_ADDRESS');
      for (const item of parsed) {
        if (
          !item.address ||
          !/^[^\s<>@]+@[^\s<>@]+$/u.test(item.address) ||
          /\p{Cc}/u.test(item.name)
        ) {
          warnings.add('INVALID_ADDRESS');
          continue;
        }
        const address = item.address;
        if (!result.some((entry) => entry.address === address))
          result.push({ name: item.name, address });
      }
    } catch {
      warnings.add('INVALID_ADDRESS');
    }
  }
  return result;
}
function messageIds(
  headers: EmailHeaders,
  name: string,
  warnings: EmailWarnings,
): string[] {
  const result: string[] = [];
  for (const value of headers.all(name)) {
    const matches = value.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? [];
    if (!matches.length || value.replace(/<[^<>\s@]+@[^<>\s@]+>/g, '').trim())
      warnings.add('INVALID_MESSAGE_ID');
    result.push(...matches);
  }
  return [...new Set(result)];
}
export function normalizeEmailHeaders(
  headers: EmailHeaders,
  internalDate: string | undefined,
  warnings: EmailWarnings,
) {
  const from = addresses(headers, 'from', warnings);
  if (!from.length) warnings.add('MISSING_FROM');
  if (from.length > 1 || headers.all('from').length > 1)
    warnings.add('AMBIGUOUS_FROM');
  const ids = messageIds(headers, 'message-id', warnings);
  if (!ids.length) warnings.add('MISSING_MESSAGE_ID');
  if (ids.length > 1) warnings.add('INVALID_MESSAGE_ID');
  const date = headers.first('date');
  const sent = date ? Date.parse(date) : NaN;
  if (date && !Number.isFinite(sent)) warnings.add('INVALID_DATE');
  const received =
    internalDate && /^\d+$/.test(internalDate) ? Number(internalDate) : NaN;
  const receivedAt =
    Number.isSafeInteger(received) &&
    Number.isFinite(new Date(received).getTime())
      ? new Date(received).toISOString()
      : null;
  if (internalDate !== undefined && !receivedAt) warnings.add('INVALID_DATE');
  return {
    from,
    to: addresses(headers, 'to', warnings),
    cc: addresses(headers, 'cc', warnings),
    bcc: addresses(headers, 'bcc', warnings),
    replyTo: addresses(headers, 'reply-to', warnings),
    subject:
      headers.first('subject') === undefined
        ? null
        : decodeHeader(headers.first('subject')!, warnings),
    internetMessageId:
      ids.length === 1 && headers.all('message-id').length === 1
        ? ids[0]
        : null,
    inReplyTo: messageIds(headers, 'in-reply-to', warnings),
    references: messageIds(headers, 'references', warnings),
    sentAt: Number.isFinite(sent) ? new Date(sent).toISOString() : null,
    // Gmail's internalDate is the arrival time; the sender's Date is not a substitute.
    receivedAt,
  };
}
