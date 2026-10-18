import { createHash } from 'node:crypto';
import type { GmailClient, GmailMessage } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { EmailParseError, type NormalizedEmail } from '@/modules/gmail/email';
import { parseGmailMessage } from '@/modules/gmail/parser';
import { readEmailHeaders } from '@/modules/gmail/email-headers';

export type SentSampleOptions = {
  mailboxAddress: string;
  aliases?: readonly string[];
  targetSize?: number;
  maxCandidates?: number;
  after?: Date;
  before?: Date;
  excludedLabelIds?: readonly string[];
  excludedAddresses?: readonly string[];
  excludedDomains?: readonly string[];
};
export type StyleSampleMessage = Readonly<{
  id: string;
  threadId: string;
  authoredText: string;
  wordCount: number;
  length: 'short' | 'medium' | 'long';
  kind: 'reply' | 'new';
}>;
export class SentSampleError extends Error {
  constructor(
    public readonly code: 'INVALID_INPUT' | 'INVALID_PAGE' | 'LIMIT_EXCEEDED',
  ) {
    super(code);
    this.name = 'SentSampleError';
  }
}
const exclusionReasons = [
  'NOT_SENT',
  'EXCLUDED_LABEL',
  'EXCLUDED_CONTACT',
  'AUTOMATED',
  'FORWARDED',
  'UNTRUSTED_AUTHOR',
  'OUTSIDE_WINDOW',
  'INVALID_MESSAGE',
  'INCOMPLETE_BODY',
  'TOO_SHORT',
  'TOO_LARGE',
  'DUPLICATE_CONTENT',
] as const;
type Exclusion = (typeof exclusionReasons)[number];
const metadataHeaders = [
  'From',
  'To',
  'Cc',
  'Bcc',
  'Subject',
  'Date',
  'Message-ID',
  'In-Reply-To',
  'References',
  'Auto-Submitted',
  'Precedence',
  'List-Id',
  'List-Unsubscribe',
  'X-Autoreply',
  'X-Autorespond',
  'Content-Type',
];
const validAddress = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[^\s<>@]+@[^\s<>@]+$/u.test(value);
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const domain = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 253 &&
  /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)*[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(
    value,
  );
const list = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined ||
  (Array.isArray(value) && value.length <= 100 && value.every(check));

export function resolveSentSampleOptions(
  input: SentSampleOptions,
  now = new Date(),
) {
  const before = input?.before ?? now;
  const yearAgo = new Date(before);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const after = input?.after ?? yearAgo;
  const targetSize = input?.targetSize ?? 200;
  const maxCandidates = input?.maxCandidates ?? 500;
  if (
    !input ||
    !validAddress(input.mailboxAddress) ||
    !list(input.aliases, validAddress) ||
    !list(input.excludedAddresses, validAddress) ||
    !list(input.excludedDomains, domain) ||
    !list(input.excludedLabelIds, safeId) ||
    !Number.isInteger(targetSize) ||
    targetSize < 200 ||
    targetSize > 500 ||
    !Number.isInteger(maxCandidates) ||
    maxCandidates < targetSize ||
    maxCandidates > 500 ||
    ![after, before, now].every(
      (date) =>
        date instanceof Date &&
        Number.isFinite(date.getTime()) &&
        date.getTime() >= 1000,
    ) ||
    after >= before ||
    before > now ||
    before.getTime() - after.getTime() < 4000
  )
    throw new SentSampleError('INVALID_INPUT');
  return {
    targetSize,
    maxCandidates,
    after: new Date(after),
    before: new Date(before),
    authors: new Set(
      [input.mailboxAddress, ...(input.aliases ?? [])].map((s) =>
        s.toLowerCase(),
      ),
    ),
    excludedLabels: new Set([
      'SPAM',
      'TRASH',
      'DRAFT',
      ...(input.excludedLabelIds ?? []),
    ]),
    excludedAddresses: new Set(
      (input.excludedAddresses ?? []).map((s) => s.toLowerCase()),
    ),
    excludedDomains: (input.excludedDomains ?? []).map((s) => s.toLowerCase()),
  };
}
type Options = ReturnType<typeof resolveSentSampleOptions>;

function metadataExclusion(
  raw: GmailMessage,
  email: NormalizedEmail,
  options: Options,
): Exclusion | null {
  if (!email.labels.includes('SENT')) return 'NOT_SENT';
  if (email.labels.some((label) => options.excludedLabels.has(label)))
    return 'EXCLUDED_LABEL';
  if (
    email.warnings.some((warning) =>
      [
        'MALFORMED_HEADERS',
        'DUPLICATE_HEADERS',
        'INVALID_ADDRESS',
        'AMBIGUOUS_FROM',
      ].includes(warning),
    )
  )
    return 'INVALID_MESSAGE';
  if (
    email.from.length !== 1 ||
    !options.authors.has(email.from[0].address.toLowerCase())
  )
    return 'UNTRUSTED_AUTHOR';
  const at = Date.parse(email.receivedAt ?? '');
  if (
    !Number.isFinite(at) ||
    at < options.after.getTime() ||
    at >= options.before.getTime()
  )
    return 'OUTSIDE_WINDOW';
  const contacts = [...email.from, ...email.to, ...email.cc, ...email.bcc];
  if (
    contacts.some(({ address }) => {
      const key = address.toLowerCase();
      const host = key.split('@')[1];
      return (
        options.excludedAddresses.has(key) ||
        options.excludedDomains.some(
          (d) => host === d || host.endsWith('.' + d),
        )
      );
    })
  )
    return 'EXCLUDED_CONTACT';
  const headers = readEmailHeaders(raw.payload?.headers, new Set());
  if (
    headers
      .all('auto-submitted')
      .some((value) => value.toLowerCase().split(';')[0].trim() !== 'no') ||
    headers
      .all('precedence')
      .some((value) => /^(?:bulk|junk|list)$/i.test(value)) ||
    ['list-id', 'list-unsubscribe', 'x-autoreply', 'x-autorespond'].some(
      (name) => headers.all(name).length,
    ) ||
    contacts.some(({ address }) =>
      /^(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon)(?:[+._-]|@)/i.test(
        address,
      ),
    ) ||
    /^(?:(?:re|aw):\s*)*(?:automatic reply|auto(?:matic)?[ -]?response|out of (?:the )?office|respuesta autom[aá]tica|fuera de la oficina|abwesenheitsnotiz)\b/i.test(
      email.subject ?? '',
    )
  )
    return 'AUTOMATED';
  if (/^(?:(?:re|aw):\s*)*(?:fw|fwd|rv|tr|wg):/i.test(email.subject ?? ''))
    return 'FORWARDED';
  return null;
}

type Candidate = {
  message: StyleSampleMessage;
  recipient: string;
  recipients: readonly string[];
  quarter: number;
  at: string;
  html: boolean;
};

// Round-robin by recipient, then writing length/reply type/time period. Reproducible,
// with at most one example per thread on the first pass.
function representative(candidates: Candidate[], size: number): Candidate[] {
  const groups = new Map<string, Map<string, Candidate[]>>();
  for (const item of candidates) {
    const variants =
      groups.get(item.recipient) ?? new Map<string, Candidate[]>();
    const key = `${item.message.length}:${item.message.kind}:${item.quarter}`;
    variants.set(key, [...(variants.get(key) ?? []), item]);
    groups.set(item.recipient, variants);
  }
  const ordered: Candidate[] = [];
  while (ordered.length < candidates.length) {
    for (const variants of groups.values()) {
      const first = variants.entries().next().value;
      if (!first) continue;
      const [key, bucket] = first;
      ordered.push(bucket.shift()!);
      variants.delete(key);
      if (bucket.length) variants.set(key, bucket);
    }
  }
  const selected: Candidate[] = [];
  const threads = new Set<string>();
  for (const item of ordered) {
    if (threads.has(item.message.threadId)) continue;
    selected.push(item);
    threads.add(item.message.threadId);
    if (selected.length === size) return selected;
  }
  for (const item of ordered) {
    if (selected.includes(item)) continue;
    selected.push(item);
    if (selected.length === size) break;
  }
  return selected;
}

export type SentSampleManifest = {
  version: 1;
  createdAt: string;
  expiresAt: string;
  window: { after: string; before: string };
  targetSize: number;
  sourceMessages: { id: string; threadId: string }[];
  statistics: {
    scanned: number;
    bodiesRead: number;
    eligible: number;
    selected: number;
    excluded: Record<Exclusion, number>;
    lengths: Record<StyleSampleMessage['length'], number>;
    kinds: Record<StyleSampleMessage['kind'], number>;
    quarters: number[];
    uniqueRecipients: number;
    uniqueThreads: number;
    htmlMessages: number;
    averageWords: number;
    oldestAt: string | null;
    newestAt: string | null;
  };
  warnings: ('BELOW_RECOMMENDED_SIZE' | 'SCAN_LIMIT_REACHED')[];
};

export async function prepareSentSample(
  client: Pick<GmailClient, 'listMessages' | 'getMessage'>,
  input: SentSampleOptions,
  consume?: (messages: readonly StyleSampleMessage[]) => Promise<void>,
  now = new Date(),
): Promise<SentSampleManifest> {
  const options = resolveSentSampleOptions(input, now);
  const excluded = Object.fromEntries(
    exclusionReasons.map((key) => [key, 0]),
  ) as Record<Exclusion, number>;
  const windows = Array.from({ length: 4 }, (_, i) => ({
    after: new Date(
      options.after.getTime() +
        Math.floor(
          ((options.before.getTime() - options.after.getTime()) * i) / 4,
        ),
    ),
    before: new Date(
      options.after.getTime() +
        Math.floor(
          ((options.before.getTime() - options.after.getTime()) * (i + 1)) / 4,
        ),
    ),
    pageToken: undefined as string | undefined,
    tokens: new Set<string>(),
    done: false,
  }));
  const seen = new Set<string>();
  const hashes = new Set<string>();
  const candidates: Candidate[] = [];
  const transient: StyleSampleMessage[] = [];
  let bodiesRead = 0;
  let totalBytes = 0;
  let pageRequests = 0;
  try {
    while (
      seen.size < options.maxCandidates &&
      windows.some((window) => !window.done)
    ) {
      for (const window of windows) {
        if (window.done || seen.size >= options.maxCandidates) continue;
        if (++pageRequests > 40) throw new SentSampleError('INVALID_PAGE');
        const page = await client.listMessages({
          mailbox: 'sent',
          after: new Date(window.after.getTime() - 1000),
          before: window.before,
          maxResults: Math.min(25, options.maxCandidates - seen.size),
          ...(window.pageToken ? { pageToken: window.pageToken } : {}),
        });
        if (page.nextPageToken && window.tokens.has(page.nextPageToken))
          throw new SentSampleError('INVALID_PAGE');
        if (page.nextPageToken) window.tokens.add(page.nextPageToken);
        window.pageToken = page.nextPageToken;
        window.done = !page.nextPageToken;
        for (const ref of page.messages) {
          if (seen.has(ref.id)) continue;
          seen.add(ref.id);
          if (seen.size > options.maxCandidates)
            throw new SentSampleError('INVALID_PAGE');
          try {
            const rawMetadata = await client.getMessage(ref.id, {
              format: 'metadata',
              metadataHeaders,
            });
            if (
              rawMetadata.id !== ref.id ||
              rawMetadata.threadId !== ref.threadId
            )
              throw new EmailParseError('INVALID_MESSAGE');
            const metadata = await parseGmailMessage(rawMetadata);
            let reason = metadataExclusion(rawMetadata, metadata, options);
            if (reason) {
              excluded[reason]++;
              continue;
            }
            // Gmail's sizeEstimate includes attachments; large messages are skipped before fetching bodies.
            if ((rawMetadata.sizeEstimate ?? 0) > 1024 * 1024) {
              excluded.TOO_LARGE++;
              continue;
            }
            const raw = await client.getMessage(ref.id, { format: 'full' });
            bodiesRead++;
            if (raw.id !== ref.id || raw.threadId !== ref.threadId)
              throw new EmailParseError('INVALID_MESSAGE');
            const email = await parseGmailMessage(raw);
            reason = metadataExclusion(raw, email, options);
            if (reason) {
              excluded[reason]++;
              continue;
            }
            if (
              email.bodyStatus === 'incomplete' ||
              email.warnings.includes('AMBIGUOUS_QUOTE')
            ) {
              excluded.INCOMPLETE_BODY++;
              continue;
            }
            if (
              email.attachments.some(
                (part) => part.mimeType === 'message/rfc822',
              ) ||
              /^\s*(?:-+\s*)?(?:forwarded message|mensaje reenviado|begin forwarded message)\b/im.test(
                email.bodyText,
              )
            ) {
              excluded.FORWARDED++;
              continue;
            }
            const text = email.authoredText;
            const wordCount =
              text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
            if (wordCount < 8) {
              excluded.TOO_SHORT++;
              continue;
            }
            if (text.length > 20000) {
              excluded.TOO_LARGE++;
              continue;
            }
            const hash = createHash('sha256')
              .update(text.replace(/\s+/g, ' ').toLowerCase())
              .digest('hex');
            if (hashes.has(hash)) {
              excluded.DUPLICATE_CONTENT++;
              continue;
            }
            hashes.add(hash);
            totalBytes += Buffer.byteLength(text);
            if (totalBytes > 5 * 1024 * 1024)
              throw new SentSampleError('LIMIT_EXCEEDED');
            const recipients = [
              ...new Set(
                [...email.to, ...email.cc, ...email.bcc].map(({ address }) =>
                  address.toLowerCase(),
                ),
              ),
            ].sort();
            candidates.push({
              message: {
                id: ref.id,
                threadId: ref.threadId,
                authoredText: text,
                wordCount,
                length:
                  wordCount < 50
                    ? 'short'
                    : wordCount < 150
                      ? 'medium'
                      : 'long',
                kind:
                  email.inReplyTo.length ||
                  /^(?:re|aw):/i.test(email.subject ?? '')
                    ? 'reply'
                    : 'new',
              },
              recipient: recipients.join(','),
              recipients,
              quarter: Math.min(
                3,
                Math.floor(
                  ((Date.parse(email.receivedAt!) - options.after.getTime()) /
                    (options.before.getTime() - options.after.getTime())) *
                    4,
                ),
              ),
              at: email.receivedAt!,
              html: hasHtml(raw),
            });
          } catch (error) {
            if (
              error instanceof EmailParseError ||
              (error instanceof ProviderError && error.code === 'NOT_FOUND')
            ) {
              excluded.INVALID_MESSAGE++;
              continue;
            }
            throw error;
          }
        }
      }
    }
    const selected = representative(candidates, options.targetSize);
    const dates = selected.map((item) => item.at).sort();
    const manifest: SentSampleManifest = {
      version: 1,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 90 * 86400000).toISOString(),
      window: {
        after: options.after.toISOString(),
        before: options.before.toISOString(),
      },
      targetSize: options.targetSize,
      sourceMessages: selected.map(({ message }) => ({
        id: message.id,
        threadId: message.threadId,
      })),
      statistics: {
        scanned: seen.size,
        bodiesRead,
        eligible: candidates.length,
        selected: selected.length,
        excluded,
        lengths: { short: 0, medium: 0, long: 0 },
        kinds: { reply: 0, new: 0 },
        quarters: [0, 0, 0, 0],
        uniqueRecipients: new Set(selected.flatMap((item) => item.recipients))
          .size,
        uniqueThreads: new Set(selected.map((item) => item.message.threadId))
          .size,
        htmlMessages: selected.filter((item) => item.html).length,
        averageWords: selected.length
          ? Math.round(
              selected.reduce((sum, item) => sum + item.message.wordCount, 0) /
                selected.length,
            )
          : 0,
        oldestAt: dates[0] ?? null,
        newestAt: dates.at(-1) ?? null,
      },
      warnings: [
        ...(selected.length < 200 ? ['BELOW_RECOMMENDED_SIZE' as const] : []),
        ...(windows.some((window) => !window.done)
          ? ['SCAN_LIMIT_REACHED' as const]
          : []),
      ],
    };
    for (const { message, quarter } of selected) {
      manifest.statistics.lengths[message.length]++;
      manifest.statistics.kinds[message.kind]++;
      manifest.statistics.quarters[quarter]++;
      transient.push(message);
    }
    if (consume) await consume(transient);
    return manifest;
  } finally {
    // No raw MIME, contacts, subjects, or authored bodies escape via the manifest.
    candidates.length = 0;
    transient.length = 0;
    hashes.clear();
  }
}

function hasHtml(raw: GmailMessage): boolean {
  const parts = raw.payload ? [raw.payload] : [];
  while (parts.length) {
    const part = parts.pop()!;
    if (part.mimeType === 'text/html') return true;
    parts.push(...(part.parts ?? []));
  }
  return false;
}
