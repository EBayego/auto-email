import type { GmailMessage } from '@/providers/contracts';

export type EmailAddress = Readonly<{ name: string; address: string }>;
export type EmailSegment = Readonly<{
  kind: 'authored' | 'quoted' | 'signature';
  text: string;
}>;
export type EmailAttachment = Readonly<{
  filename: string | null;
  mimeType: string;
  size: number | null;
  inline: boolean;
  contentId: string | null;
  partId?: string;
  attachmentId?: string;
}>;
export type EmailParseWarning =
  | 'MALFORMED_HEADERS'
  | 'DUPLICATE_HEADERS'
  | 'MISSING_FROM'
  | 'AMBIGUOUS_FROM'
  | 'INVALID_ADDRESS'
  | 'INVALID_DATE'
  | 'INVALID_MESSAGE_ID'
  | 'MISSING_MESSAGE_ID'
  | 'BODY_NOT_LOADED'
  | 'UNSUPPORTED_BODY'
  | 'INVALID_BASE64'
  | 'INVALID_TEXT_ENCODING'
  | 'UNSUPPORTED_CHARSET'
  | 'ASSUMED_CHARSET'
  | 'AMBIGUOUS_QUOTE';
export type NormalizedEmail = Readonly<{
  id: string;
  threadId: string;
  labels: readonly string[];
  from: readonly EmailAddress[];
  to: readonly EmailAddress[];
  cc: readonly EmailAddress[];
  bcc: readonly EmailAddress[];
  replyTo: readonly EmailAddress[];
  subject: string | null;
  internetMessageId: string | null;
  inReplyTo: readonly string[];
  references: readonly string[];
  sentAt: string | null;
  receivedAt: string | null;
  bodyText: string;
  authoredText: string;
  segments: readonly EmailSegment[];
  bodyStatus: 'complete' | 'empty' | 'incomplete';
  isEmpty: boolean;
  hasAttachments: boolean;
  attachments: readonly EmailAttachment[];
  warnings: readonly EmailParseWarning[];
  original?: GmailMessage;
}>;

export class EmailParseError extends Error {
  constructor(
    public readonly code: 'INVALID_MESSAGE' | 'INVALID_MIME' | 'LIMIT_EXCEEDED',
  ) {
    super(code);
    this.name = 'EmailParseError';
  }
}

export const emailLimits = Object.freeze({
  bytes: 10 * 1024 * 1024,
  headerBytes: 256 * 1024,
  parts: 1000,
  depth: 30,
});
export type EmailWarnings = Set<EmailParseWarning>;
export type EmailHeader = Readonly<{ name: string; value: string }>;
export type EmailBody = { text?: string; html?: string };
