import type {
  GmailClient,
  GmailMessage,
  GmailThread,
} from '@/providers/contracts';
import { parseGmailMessage } from '@/modules/gmail/parser';
import { EmailStylePreprocessor } from '@/modules/identity/email-style-preprocessor';
import {
  prepareSentSample,
  type SentSampleManifest,
  type StyleSampleMessage,
} from '@/modules/identity/sent-sample';
import {
  StyleEvaluationError,
  validateEvaluationCorpus,
  type EvaluationCaseReference,
  type StyleEvaluationCorpus,
} from '@/modules/identity/style-evaluation';

export type EvaluationIdentity = {
  userId: string;
  gmailAccountId: string;
  mailboxAddress: string;
  aliases?: readonly string[];
};
export type HistoricalStyleCase = {
  reference: EvaluationCaseReference;
  thread: GmailThread;
  authoredReply: string;
  recipient: string;
  targetAt: string;
};
const preprocessor = new EmailStylePreprocessor();
export async function loadHistoricalStyleCase(
  gmail: Pick<GmailClient, 'getThread'>,
  reference: EvaluationCaseReference,
  identity: EvaluationIdentity,
  now = new Date(),
): Promise<HistoricalStyleCase> {
  const thread = await gmail.getThread(reference.threadId, { format: 'full' });
  if (
    thread.id !== reference.threadId ||
    !Array.isArray(thread.messages) ||
    thread.messages.length > 100 ||
    new Set(thread.messages.map((m) => m.id)).size !== thread.messages.length ||
    thread.messages.some((m) => m.threadId !== reference.threadId)
  )
    throw new StyleEvaluationError('INVALID_HISTORICAL_PAIR');
  const targetRaw = thread.messages.find(
    (message) => message.id === reference.targetMessageId,
  );
  const replyRaw = thread.messages.find(
    (message) => message.id === reference.replyMessageId,
  );
  if (!targetRaw || !replyRaw)
    throw new StyleEvaluationError('INVALID_HISTORICAL_PAIR');
  const target = await parseGmailMessage(targetRaw),
    reply = await parseGmailMessage(replyRaw);
  const authors = new Set(
    [identity.mailboxAddress, ...(identity.aliases ?? [])].map((s) =>
      s.toLowerCase(),
    ),
  );
  const targetAt = Date.parse(target.receivedAt ?? ''),
    replyAt = Date.parse(reply.receivedAt ?? '');
  const invalidMetadata = (email: typeof target) =>
    email.warnings.some((code) =>
      [
        'MALFORMED_HEADERS',
        'DUPLICATE_HEADERS',
        'INVALID_ADDRESS',
        'AMBIGUOUS_FROM',
        'AMBIGUOUS_QUOTE',
        'INVALID_MESSAGE_ID',
      ].includes(code),
    );
  if (
    !Number.isFinite(targetAt) ||
    !Number.isFinite(replyAt) ||
    replyAt <= targetAt ||
    replyAt > now.getTime() ||
    target.labels.some((label) =>
      ['SENT', 'DRAFT', 'TRASH', 'SPAM'].includes(label),
    ) ||
    target.from.length !== 1 ||
    authors.has(target.from[0].address.toLowerCase()) ||
    !target.internetMessageId ||
    !reply.inReplyTo.includes(target.internetMessageId) ||
    !reply.labels.includes('SENT') ||
    reply.labels.some((label) => ['TRASH', 'SPAM', 'DRAFT'].includes(label)) ||
    reply.from.length !== 1 ||
    !authors.has(reply.from[0].address.toLowerCase()) ||
    reply.to.length !== 1 ||
    reply.to[0].address.toLowerCase() !==
      target.from[0].address.toLowerCase() ||
    reply.cc.length ||
    reply.bcc.length ||
    reply.bodyStatus !== 'complete' ||
    invalidMetadata(target) ||
    invalidMetadata(reply)
  )
    throw new StyleEvaluationError('INVALID_HISTORICAL_PAIR');
  const cleaned = preprocessor.preprocess(reply, replyRaw.payload?.headers);
  if (
    cleaned.exclusion ||
    cleaned.hasForwardedContent ||
    cleaned.authoredText.length > 20000 ||
    cleaned.authoredText.trim().split(/\s+/u).length < 8
  )
    throw new StyleEvaluationError('INVALID_HISTORICAL_PAIR');
  const prefix: GmailMessage[] = thread.messages
    .filter((message) => {
      const at = Number(message.internalDate);
      return (
        Number.isFinite(at) &&
        at <= targetAt &&
        !message.labelIds?.includes('DRAFT')
      );
    })
    .map((message) => ({
      ...message,
      ...(message.id === reference.targetMessageId
        ? { labelIds: [...new Set([...(message.labelIds ?? []), 'INBOX'])] }
        : {}),
    }));
  // Reconstruct the historical inbox in memory only. The reference answer and all
  // later messages are absent from the generator, including snippets/raw MIME.
  return {
    reference,
    thread: { id: thread.id, messages: prefix },
    authoredReply: cleaned.authoredText,
    recipient: target.from[0].address.toLowerCase(),
    targetAt: new Date(targetAt).toISOString(),
  };
}
export async function prepareStyleEvaluationCorpus(input: {
  gmail: Pick<GmailClient, 'getThread'>;
  identity: EvaluationIdentity;
  sample: SentSampleManifest;
  cases: EvaluationCaseReference[];
  seed: string;
  now?: Date;
}): Promise<StyleEvaluationCorpus> {
  const now = input.now ?? new Date();
  const heldout = new Set(input.cases.map((c) => c.threadId));
  const corpus = validateEvaluationCorpus(
    {
      version: 1,
      userId: input.identity.userId,
      gmailAccountId: input.identity.gmailAccountId,
      seed: input.seed,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        Math.min(
          now.getTime() + 90 * 86400000,
          Date.parse(input.sample.expiresAt),
        ),
      ).toISOString(),
      cases: input.cases,
      training: {
        ...input.sample.window,
        targetSize: input.sample.targetSize,
        sourceMessages: input.sample.sourceMessages.filter(
          (ref) => !heldout.has(ref.threadId),
        ),
      },
    },
    input.identity,
    now,
  );
  // Preparation validates references, not model quality. No profile/model calls.
  for (const reference of corpus.cases)
    await loadHistoricalStyleCase(input.gmail, reference, input.identity, now);
  return corpus;
}
export async function withEvaluationTraining(
  gmail: Pick<GmailClient, 'getMessage'>,
  corpus: StyleEvaluationCorpus,
  identity: EvaluationIdentity,
  before: Date,
  consume: (messages: readonly StyleSampleMessage[]) => Promise<void>,
  now: Date,
) {
  const refs = corpus.training.sourceMessages;
  const holdout = new Set(corpus.cases.map((c) => c.threadId));
  const allowed = new Set(refs.map((ref) => ref.id));
  if (before.getTime() - Date.parse(corpus.training.after) < 4000)
    throw new StyleEvaluationError('TRAINING_REQUIRED');
  let listed = false;
  await prepareSentSample(
    {
      async listMessages() {
        if (listed) return { messages: [] };
        listed = true;
        return { messages: refs };
      },
      async getMessage(id, options) {
        if (!allowed.has(id))
          throw new StyleEvaluationError('CONTAMINATED_HOLDOUT');
        const message = await gmail.getMessage(id, options);
        if (holdout.has(message.threadId))
          throw new StyleEvaluationError('CONTAMINATED_HOLDOUT');
        return message;
      },
    },
    {
      mailboxAddress: identity.mailboxAddress,
      aliases: identity.aliases,
      targetSize: corpus.training.targetSize,
      after: new Date(corpus.training.after),
      before: new Date(
        Math.min(before.getTime(), Date.parse(corpus.training.before)),
      ),
      includeRecipientContext: true,
    },
    async (messages) => {
      if (messages.length < 10)
        throw new StyleEvaluationError('TRAINING_REQUIRED');
      await consume(messages);
    },
    now,
  );
}
