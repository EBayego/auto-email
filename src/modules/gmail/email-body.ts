import PostalMime from 'postal-mime';
import type { GmailMessage, GmailMessagePart } from '@/providers/contracts';
import {
  emailLimits,
  EmailParseError,
  type EmailAttachment,
  type EmailBody,
  type EmailHeader,
  type EmailWarnings,
} from './email';
import { decodeHeader, readEmailHeaders } from './email-headers';

export function decodeBase64Url(value: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(value))
    throw new EmailParseError('INVALID_MIME');
  if (value.length > Math.ceil(emailLimits.bytes / 3) * 4)
    throw new EmailParseError('LIMIT_EXCEEDED');
  const bytes = Buffer.from(value, 'base64url');
  if (
    bytes.toString('base64url') !== value.replace(/=+$/, '') ||
    (value.includes('=') && value.length % 4 !== 0)
  )
    throw new EmailParseError('INVALID_MIME');
  if (bytes.length > emailLimits.bytes)
    throw new EmailParseError('LIMIT_EXCEEDED');
  return bytes;
}

function decodeText(
  bytes: Buffer,
  contentType: string,
  warnings: EmailWarnings,
): string {
  const charset = /;\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(
    contentType,
  );
  const encoding = charset?.[1] ?? charset?.[2] ?? 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof RangeError) warnings.add('UNSUPPORTED_CHARSET');
    else if (!charset) {
      warnings.add('ASSUMED_CHARSET');
      return new TextDecoder('windows-1252').decode(bytes);
    } else warnings.add('INVALID_TEXT_ENCODING');
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function readEmailBody(
  message: GmailMessage,
  warnings: EmailWarnings,
): Promise<{
  headers: readonly EmailHeader[];
  bodies: EmailBody[];
  attachments: EmailAttachment[];
}> {
  if (message.raw !== undefined) {
    const raw = decodeBase64Url(message.raw);
    const headerBlock = raw
      .subarray(0, Math.min(raw.length, emailLimits.headerBytes + 4))
      .toString('latin1')
      .split(/\r?\n\r?\n/, 1)[0];
    if (Buffer.byteLength(headerBlock, 'latin1') > emailLimits.headerBytes)
      throw new EmailParseError('LIMIT_EXCEEDED');
    if (
      headerBlock
        .split(/\r?\n/)
        .some(
          (line) =>
            line &&
            !/^[\t ]/.test(line) &&
            !/^[!#$%&'*+.^_`|~\w-]+:/.test(line),
        )
    )
      warnings.add('MALFORMED_HEADERS');
    let parsed;
    try {
      parsed = await PostalMime.parse(raw, {
        maxNestingDepth: emailLimits.depth,
        maxPartCount: emailLimits.parts,
        maxHeadersSize: emailLimits.headerBytes,
        forceRfc822Attachments: true,
        maxRfc822NestingDepth: 0,
      });
    } catch {
      // Do not propagate parser errors: they can contain original headers or bodies.
      throw new EmailParseError('INVALID_MIME');
    }
    return {
      headers: parsed.headers.map(({ originalKey, value }) => ({
        name: originalKey,
        value,
      })),
      bodies: [{ text: parsed.text, html: parsed.html }],
      attachments: parsed.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size:
          typeof attachment.content === 'string'
            ? Buffer.byteLength(attachment.content)
            : attachment.content.byteLength,
        inline:
          attachment.disposition === 'inline' || attachment.related === true,
        contentId: attachment.contentId ?? null,
      })),
    };
  }

  const attachments: EmailAttachment[] = [];
  let parts = 0;
  let bytesRead = 0;
  let headerBytes = 0;
  function visit(part: GmailMessagePart, depth = 0): EmailBody[] {
    if (++parts > emailLimits.parts || depth > emailLimits.depth)
      throw new EmailParseError('LIMIT_EXCEEDED');
    if (!part || typeof part !== 'object' || Array.isArray(part))
      throw new EmailParseError('INVALID_MESSAGE');
    if (part.headers !== undefined && !Array.isArray(part.headers))
      throw new EmailParseError('INVALID_MESSAGE');
    for (const header of part.headers ?? []) {
      if (
        header &&
        typeof header.name === 'string' &&
        typeof header.value === 'string'
      )
        headerBytes +=
          Buffer.byteLength(header.name) + Buffer.byteLength(header.value) + 64;
    }
    if (headerBytes > emailLimits.headerBytes)
      throw new EmailParseError('LIMIT_EXCEEDED');
    const headers = readEmailHeaders(part.headers, warnings);
    const contentType =
      headers.first('content-type') ?? part.mimeType ?? 'text/plain';
    const mimeType = (part.mimeType ?? contentType.split(';')[0])
      .toLowerCase()
      .trim();
    const disposition = headers.first('content-disposition') ?? '';
    const attached =
      !!part.filename ||
      /^attachment(?:;|$)/i.test(disposition) ||
      mimeType === 'message/rfc822' ||
      (!mimeType.startsWith('multipart/') &&
        mimeType !== 'text/plain' &&
        mimeType !== 'text/html');
    if (attached) {
      attachments.push({
        filename: part.filename ? decodeHeader(part.filename, warnings) : null,
        mimeType,
        size: part.body?.size ?? null,
        inline:
          /^inline(?:;|$)/i.test(disposition) ||
          headers.first('content-id') !== undefined,
        contentId: headers.first('content-id') ?? null,
        ...(part.partId !== undefined ? { partId: part.partId } : {}),
        ...(part.body?.attachmentId
          ? { attachmentId: part.body.attachmentId }
          : {}),
      });
      return [];
    }
    if (mimeType.startsWith('multipart/')) {
      if (part.parts !== undefined && !Array.isArray(part.parts))
        throw new EmailParseError('INVALID_MESSAGE');
      const children = (part.parts ?? []).map((child) =>
        visit(child, depth + 1),
      );
      if (!children.length) warnings.add('BODY_NOT_LOADED');
      if (mimeType === 'multipart/alternative') {
        const alternatives = children.flat();
        const text = alternatives
          .filter((body) => body.text?.trim())
          .at(-1)?.text;
        const html = alternatives
          .filter((body) => body.html?.trim())
          .at(-1)?.html;
        return [{ text, html }];
      }
      return children.flat();
    }
    if (part.body?.data === undefined) {
      if (part.body?.attachmentId || part.body?.size !== 0)
        warnings.add('BODY_NOT_LOADED');
      return [{ text: '' }];
    }
    let decoded: Buffer;
    try {
      decoded = decodeBase64Url(part.body.data);
    } catch (error) {
      if (error instanceof EmailParseError && error.code === 'LIMIT_EXCEEDED')
        throw error;
      warnings.add('INVALID_BASE64');
      return [];
    }
    bytesRead += decoded.length;
    if (bytesRead > emailLimits.bytes)
      throw new EmailParseError('LIMIT_EXCEEDED');
    // Gmail already decoded the MIME transfer encoding. Only unwrap Base64URL here.
    const text = decodeText(decoded, contentType, warnings);
    return [mimeType === 'text/html' ? { html: text } : { text }];
  }
  if (!message.payload) {
    warnings.add('BODY_NOT_LOADED');
    return { headers: [], bodies: [], attachments };
  }
  const bodies = visit(message.payload);
  if (!bodies.length && attachments.length) warnings.add('UNSUPPORTED_BODY');
  return { headers: message.payload.headers ?? [], bodies, attachments };
}
