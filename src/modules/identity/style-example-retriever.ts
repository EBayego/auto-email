import type {
  GmailClient,
  GmailMessage,
  GmailMessageReference,
} from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { EmailParseError } from '@/modules/gmail/email';
import { parseGmailMessage } from '@/modules/gmail/parser';
import { detectReplyLanguage } from '@/modules/response/language';
import {
  prepareSentSample,
  resolveSentSampleOptions,
  sentSampleMetadataExclusion,
  sentSampleMetadataHeaders,
  type SentSampleManifest,
} from './sent-sample';
import type { WritingProfile } from './writing-profile';

export type StyleExample = Readonly<{ text: string }>;
export type StyleExampleRequest = {
  accountId: string;
  recipient: string;
  threadId: string;
  subject: string | null;
  text: string;
  before?: Date;
  limit?: number;
  profile?: WritingProfile | null;
  preferredMessageIds?: readonly string[];
  now?: Date;
  language?: string;
};
export interface StyleExampleRetriever {
  retrieve(request: StyleExampleRequest): Promise<StyleExample[]>;
}
export class StyleExampleRetrievalError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'ACCOUNT_MISMATCH') {
    super(code);
    this.name = 'StyleExampleRetrievalError';
  }
}
export const styleExampleLimits = Object.freeze({
  version: 'mail028-examples-v2',
  examples: 3,
  characters: 2000,
  searchResults: 20,
  metadata: 60,
  bodies: 12,
  historyDays: 365,
});
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const address = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`|~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(
    value,
  );
const stopWords = new Set(
  `about after again antes avec buenos buenas cordialmente could cuando desde donde email esta este esto gracias hello hola kind regards lundi lunes muchas mucho para please propuesta proyecto pues puis regards respuesta salut saludos sobre thanks that the their them there these this todo todos tres vous when where which with would your yours`.split(
    ' ',
  ),
);
const terms = (value: string) => [
  ...new Set(
    (
      value
        .slice(0, 8000)
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/https?:\/\/\S+|\S+@\S+/gu, ' ')
        .match(/\p{L}{4,32}/gu) ?? []
    ).filter((term) => !stopWords.has(term)),
  ),
];
const overlap = (left: readonly string[], right: readonly string[]) => {
  const common = left.filter((term) => right.includes(term)).length;
  return {
    common,
    ratio: common / Math.max(1, Math.min(left.length, right.length)),
  };
};
const unavailable = (error: unknown) =>
  error instanceof EmailParseError ||
  (error instanceof ProviderError && error.code === 'NOT_FOUND');

// The client and identity come from the same authorized account as the thread.
// References never route to another mailbox; bodies have no shared index/cache.
export function createStyleExampleRetriever(input: {
  gmail: Pick<GmailClient, 'listMessages' | 'getMessage'>;
  identity: {
    accountId: string;
    mailboxAddress: string;
    aliases?: readonly string[];
  };
  sample?: SentSampleManifest | null;
  sourceReferences?: readonly GmailMessageReference[];
}): StyleExampleRetriever {
  const identity = {
    ...input.identity,
    aliases: [...(input.identity.aliases ?? [])],
  };
  if (!safeId(identity.accountId))
    throw new StyleExampleRetrievalError('INVALID_INPUT');
  if (
    input.sourceReferences !== undefined &&
    (!Array.isArray(input.sourceReferences) ||
      input.sourceReferences.length > 500 ||
      input.sourceReferences.some(
        (ref) => !safeId(ref.id) || !safeId(ref.threadId),
      ))
  )
    throw new StyleExampleRetrievalError('INVALID_INPUT');
  return Object.freeze({
    async retrieve(request: StyleExampleRequest): Promise<StyleExample[]> {
      const now = request.now ?? new Date();
      const before = request.before ?? now;
      const limit = request.limit ?? styleExampleLimits.examples;
      if (request.accountId !== identity.accountId)
        throw new StyleExampleRetrievalError('ACCOUNT_MISMATCH');
      const sample = input.sample as
        (SentSampleManifest & { gmailAccountId?: string }) | null | undefined;
      if (
        sample?.gmailAccountId !== undefined &&
        sample.gmailAccountId !== identity.accountId
      )
        throw new StyleExampleRetrievalError('ACCOUNT_MISMATCH');
      if (
        !address(request.recipient) ||
        !safeId(request.threadId) ||
        (request.language !== undefined &&
          !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(request.language)) ||
        typeof request.text !== 'string' ||
        request.text.length > 64 * 1024 ||
        (request.subject !== null &&
          (typeof request.subject !== 'string' ||
            request.subject.length > 4096)) ||
        !Number.isInteger(limit) ||
        limit < 0 ||
        limit > styleExampleLimits.examples ||
        ![now, before].every(
          (date) => date instanceof Date && Number.isFinite(date.getTime()),
        ) ||
        (request.preferredMessageIds !== undefined &&
          (!Array.isArray(request.preferredMessageIds) ||
            request.preferredMessageIds.length > 500 ||
            !request.preferredMessageIds.every(safeId)))
      )
        throw new StyleExampleRetrievalError('INVALID_INPUT');
      const after = new Date(
        now.getTime() - styleExampleLimits.historyDays * 86400000,
      );
      const cutoff = new Date(Math.min(before.getTime(), now.getTime()));
      const options = resolveSentSampleOptions(
        { ...identity, after, before: now },
        now,
      );
      if (!limit || cutoff.getTime() - after.getTime() < 4000) return [];
      options.before = cutoff;
      const recipient = request.recipient.toLowerCase();
      const subjectTerms = terms(request.subject ?? '');
      const targetTerms = terms(`${request.subject ?? ''} ${request.text}`);
      const searchTerms = (
        subjectTerms.length ? subjectTerms : targetTerms
      ).slice(0, 3);
      const preferred = new Set(request.preferredMessageIds ?? []);
      const references = new Map<string, GmailMessageReference>();
      const metadata = new Map<string, GmailMessage>();
      const candidates: {
        ref: GmailMessageReference;
        score: number;
        at: number;
      }[] = [];
      const examples: StyleExample[] = [];
      try {
        // Single-page, typed searches: untrusted text cannot add Gmail operators.
        for (const query of input.sourceReferences !== undefined
          ? []
          : [
              { to: recipient },
              ...(searchTerms.length ? [{ textTerms: searchTerms }] : []),
            ]) {
          const page = await input.gmail.listMessages({
            mailbox: 'sent',
            after: new Date(after.getTime() - 1000),
            before: cutoff,
            maxResults: styleExampleLimits.searchResults,
            ...query,
          });
          if (
            !Array.isArray(page.messages) ||
            page.messages.length > styleExampleLimits.searchResults
          )
            throw new StyleExampleRetrievalError('INVALID_INPUT');
          for (const ref of page.messages) {
            if (!safeId(ref.id) || !safeId(ref.threadId))
              throw new StyleExampleRetrievalError('INVALID_INPUT');
            if (ref.threadId !== request.threadId)
              references.set(ref.id, { id: ref.id, threadId: ref.threadId });
          }
        }
        for (const ref of input.sourceReferences ?? []) {
          if (references.size >= styleExampleLimits.metadata) break;
          if (ref.threadId !== request.threadId)
            references.set(ref.id, { id: ref.id, threadId: ref.threadId });
        }
        if (
          input.sourceReferences === undefined &&
          sample &&
          sample.version === 1 &&
          Date.parse(sample.createdAt) <= now.getTime() &&
          Date.parse(sample.expiresAt) > now.getTime()
        ) {
          if (
            !Array.isArray(sample.sourceMessages) ||
            sample.sourceMessages.length > 500 ||
            sample.sourceMessages.some(
              (ref) => !safeId(ref.id) || !safeId(ref.threadId),
            )
          )
            throw new StyleExampleRetrievalError('INVALID_INPUT');
          const recorded = [...sample.sourceMessages].sort(
            (a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)),
          );
          for (const ref of recorded) {
            if (references.size >= styleExampleLimits.metadata) break;
            if (ref.threadId !== request.threadId)
              references.set(ref.id, { id: ref.id, threadId: ref.threadId });
          }
        }
        for (const ref of references.values()) {
          try {
            const raw = await input.gmail.getMessage(ref.id, {
              format: 'metadata',
              metadataHeaders: sentSampleMetadataHeaders,
            });
            if (
              raw.id !== ref.id ||
              raw.threadId !== ref.threadId ||
              (raw.sizeEstimate ?? 0) > 1024 * 1024
            )
              continue;
            const email = await parseGmailMessage(raw);
            if (
              sentSampleMetadataExclusion(raw, email, options) ||
              email.to.length !== 1 ||
              email.cc.length ||
              email.bcc.length ||
              options.authors.has(email.to[0].address.toLowerCase())
            )
              continue;
            const sameRecipient =
              email.to[0].address.toLowerCase() === recipient;
            const topical = overlap(targetTerms, terms(email.subject ?? ''));
            const at = Date.parse(email.receivedAt!);
            candidates.push({
              ref,
              at,
              score:
                (sameRecipient ? 80 : 0) +
                Math.min(20, topical.common * 6) +
                (5 * (at - after.getTime())) /
                  (now.getTime() - after.getTime()) +
                (preferred.has(ref.id) ? 2 : 0),
            });
            metadata.set(ref.id, raw);
          } catch (error) {
            if (!unavailable(error)) throw error;
          }
        }
        candidates.sort(
          (a, b) =>
            b.score - a.score ||
            b.at - a.at ||
            a.ref.id.localeCompare(b.ref.id),
        );
        const candidateThreads = new Set<string>();
        const selected = candidates
          .filter(({ ref }) => {
            if (candidateThreads.has(ref.threadId)) return false;
            candidateThreads.add(ref.threadId);
            return true;
          })
          .slice(0, styleExampleLimits.bodies);
        if (!selected.length) return [];
        let listed = false;
        await prepareSentSample(
          {
            async listMessages() {
              if (listed) return { messages: [] };
              listed = true;
              return { messages: selected.map(({ ref }) => ref) };
            },
            async getMessage(id, getOptions) {
              if (getOptions?.format === 'metadata') return metadata.get(id)!;
              return input.gmail.getMessage(id, getOptions);
            },
          },
          { ...identity, after, before: cutoff, includeRecipientContext: true },
          async (messages) => {
            const targetLanguage =
              request.language?.split('-')[0] ??
              detectReplyLanguage(request.text);
            const ranked = messages
              .flatMap((message) => {
                if (!message.context || message.threadId === request.threadId)
                  return [];
                // A very short new message is poor evidence for the structure of
                // a reply. Keep short authentic replies, which can be a real style.
                if (message.kind === 'new' && message.wordCount < 12) return [];
                const sameRecipient = message.context.recipient === recipient;
                const candidateLanguage = detectReplyLanguage(
                  message.authoredText,
                );
                if (
                  targetLanguage &&
                  candidateLanguage &&
                  candidateLanguage !== targetLanguage
                )
                  return [];
                const bodyTerms = terms(message.authoredText);
                const subject = message.context.subject ?? '';
                const topical = overlap(targetTerms, [
                  ...new Set([...terms(subject), ...bodyTerms]),
                ]);
                // Search matches are hints. Revalidate full-message authorship,
                // recipients and relevance, including changes since the metadata read.
                if (
                  !sameRecipient &&
                  (topical.common < 2 || topical.ratio < 0.15)
                )
                  return [];
                const at = Date.parse(message.context.sentAt);
                const score =
                  (sameRecipient ? 80 : 0) +
                  Math.min(20, topical.common * 4) +
                  (5 * (at - after.getTime())) /
                    (now.getTime() - after.getTime()) +
                  (message.kind === 'reply' ? 3 : 0) +
                  (message.length === request.profile?.average_length ? 2 : 0) +
                  (targetLanguage &&
                  detectReplyLanguage(message.authoredText) === targetLanguage
                    ? 2
                    : 0) +
                  (preferred.has(message.id) ? 2 : 0);
                return [{ message, score, at, bodyTerms }];
              })
              .sort(
                (a, b) =>
                  b.score - a.score ||
                  b.at - a.at ||
                  a.message.id.localeCompare(b.message.id),
              );
            const threads = new Set<string>();
            const selectedTerms: string[][] = [];
            for (const { message, bodyTerms } of ranked) {
              if (
                threads.has(message.threadId) ||
                selectedTerms.some(
                  (previous) =>
                    overlap(previous, bodyTerms).common /
                      Math.max(1, new Set([...previous, ...bodyTerms]).size) >
                    0.85,
                )
              )
                continue;
              const text = message.authoredText;
              examples.push({
                text:
                  text.length <= styleExampleLimits.characters
                    ? text
                    : text.slice(0, 980) +
                      '\n[fragmento omitido]\n' +
                      text.slice(-980),
              });
              threads.add(message.threadId);
              selectedTerms.push(bodyTerms);
              if (examples.length === limit) break;
            }
          },
          now,
        );
        return examples;
      } catch (error) {
        examples.length = 0;
        throw error;
      } finally {
        references.clear();
        metadata.clear();
        candidates.length = 0;
      }
    },
  });
}
