import type {
  GmailClient,
  GmailMessagePart,
  GmailThread,
} from '@/providers/contracts';
import type { EmailAddress, NormalizedEmail } from './email';
import { parseGmailMessage } from './parser';

export type ConversationIssue =
  | 'UNKNOWN_AUTHOR'
  | 'UNVERIFIED_ALIAS'
  | 'UNTRUSTED_CHRONOLOGY'
  | 'AMBIGUOUS_CHRONOLOGY'
  | 'DUPLICATE_MESSAGE_ID'
  | 'INVALID_MESSAGE_METADATA'
  | 'INCOMPLETE_BODY'
  | 'AMBIGUOUS_CONTENT'
  | 'EMPTY_TARGET'
  | 'AMBIGUOUS_RECIPIENTS'
  | 'POSSIBLE_REPLY'
  | 'EXCLUDED_MESSAGES'
  | 'TARGET_NOT_INCOMING'
  | 'TARGET_EXCLUDED';
export type ConversationMessage = NormalizedEmail &
  Readonly<{
    author: 'owner' | 'participant' | 'unknown';
    direction: 'incoming' | 'outgoing' | 'self' | 'unknown';
    chronologicalAt: string | null;
    timestampSource: 'gmail' | 'header' | 'unknown';
    answeredByMessageIds: readonly string[];
    possiblyAnsweredByMessageIds: readonly string[];
  }>;
export type ThreadContext = Readonly<{
  accountId: string;
  threadId: string;
  historyId: string | null;
  messages: readonly ConversationMessage[];
  participants: readonly (EmailAddress & { isOwner: boolean })[];
  excludedMessageIds: readonly string[];
  drafts: readonly Readonly<{ id: string; isManaged: boolean }>[];
  hasDraft: boolean;
  hasManualDraft: boolean;
  latestIncomingMessageId: string | null;
  targetMessageId: string | null;
  pendingMessageIds: readonly string[];
  isAlreadyAnswered: boolean;
  answeredByMessageIds: readonly string[];
  possiblyAnsweredByMessageIds: readonly string[];
  status:
    | 'NEEDS_CLASSIFICATION'
    | 'ALREADY_ANSWERED'
    | 'EXISTING_DRAFT'
    | 'SUPERSEDED'
    | 'NO_CANDIDATE'
    | 'REVIEW_REQUIRED';
  issues: readonly ConversationIssue[];
}>;
export type ConversationInput = Readonly<{
  accountId: string;
  mailboxAddress: string;
  // Only aliases verified by the caller; never inferred from received headers.
  aliases?: readonly string[];
  targetMessageId?: string;
  managedDraftMessageIds?: readonly string[];
}>;
export class ConversationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'INVALID_THREAD'
      | 'TARGET_NOT_FOUND'
      | 'LIMIT_EXCEEDED'
      | 'MESSAGE_PARSE_FAILED',
  ) {
    super(code);
    this.name = 'ConversationError';
  }
}
export const conversationLimits = Object.freeze({
  messages: 100,
  bytes: 20 * 1024 * 1024,
});
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const addressKey = (address: string) => address.toLowerCase();
const validAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+$/u.test(value);
const excluded = (labels: readonly string[] = []) =>
  labels.some((label) => label === 'SPAM' || label === 'TRASH');

function identity(input: ConversationInput) {
  if (
    !input ||
    !safeId(input.accountId) ||
    !validAddress(input.mailboxAddress) ||
    (input.targetMessageId !== undefined && !safeId(input.targetMessageId)) ||
    (input.aliases !== undefined &&
      (!Array.isArray(input.aliases) ||
        input.aliases.length > 100 ||
        !input.aliases.every(validAddress))) ||
    (input.managedDraftMessageIds !== undefined &&
      (!Array.isArray(input.managedDraftMessageIds) ||
        !input.managedDraftMessageIds.every(safeId)))
  )
    throw new ConversationError('INVALID_INPUT');
  return new Set(
    [input.mailboxAddress, ...(input.aliases ?? [])].map(addressKey),
  );
}

// Reject oversized context rather than silently discard an earlier answer or draft.
function checkThread(thread: GmailThread) {
  if (!thread || !safeId(thread.id) || !Array.isArray(thread.messages))
    throw new ConversationError('INVALID_THREAD');
  if (thread.messages.length > conversationLimits.messages)
    throw new ConversationError('LIMIT_EXCEEDED');
  let bytes = 0;
  const seen = new Set<string>();
  for (const message of thread.messages) {
    if (
      !message ||
      !safeId(message.id) ||
      message.threadId !== thread.id ||
      seen.has(message.id) ||
      (message.labelIds !== undefined &&
        (!Array.isArray(message.labelIds) ||
          !message.labelIds.every(
            (label: unknown) => typeof label === 'string',
          )))
    )
      throw new ConversationError('INVALID_THREAD');
    seen.add(message.id);
    bytes += message.raw?.length ?? 0;
    const stack: { part: GmailMessagePart; depth: number }[] = message.payload
      ? [{ part: message.payload, depth: 0 }]
      : [];
    let parts = 0;
    while (stack.length) {
      const { part, depth } = stack.pop()!;
      if (!part || depth > 30 || ++parts > 1000)
        throw new ConversationError('LIMIT_EXCEEDED');
      bytes += part.body?.data?.length ?? 0;
      for (const header of part.headers ?? []) {
        if (
          header &&
          typeof header.name === 'string' &&
          typeof header.value === 'string'
        )
          bytes +=
            Buffer.byteLength(header.name) + Buffer.byteLength(header.value);
      }
      for (const child of part.parts ?? [])
        stack.push({ part: child, depth: depth + 1 });
    }
    if (bytes > conversationLimits.bytes)
      throw new ConversationError('LIMIT_EXCEEDED');
  }
}

export async function reconstructConversation(
  thread: GmailThread,
  input: ConversationInput,
): Promise<ThreadContext> {
  const ownAddresses = identity(input);
  checkThread(thread);
  if (
    input.targetMessageId &&
    !thread.messages.some((message) => message.id === input.targetMessageId)
  )
    throw new ConversationError('TARGET_NOT_FOUND');
  const issues = new Set<ConversationIssue>();
  const managed = new Set(input.managedDraftMessageIds ?? []);
  const drafts = thread.messages
    .filter((message) => message.labelIds?.includes('DRAFT'))
    .map((message) => ({ id: message.id, isManaged: managed.has(message.id) }));
  const excludedMessageIds = thread.messages
    .filter((message) => excluded(message.labelIds))
    .map((message) => message.id);
  if (excludedMessageIds.length) issues.add('EXCLUDED_MESSAGES');
  const messages: ConversationMessage[] = [];
  for (const raw of thread.messages) {
    if (raw.labelIds?.includes('DRAFT') || excluded(raw.labelIds)) continue;
    let email: NormalizedEmail;
    try {
      email = await parseGmailMessage(raw);
    } catch {
      throw new ConversationError('MESSAGE_PARSE_FAILED');
    }
    const sent = email.labels.includes('SENT');
    const knownSender =
      email.from.length === 1 &&
      ownAddresses.has(addressKey(email.from[0].address));
    const author = sent
      ? 'owner'
      : email.from.length === 1 && !knownSender
        ? 'participant'
        : 'unknown';
    if (author === 'unknown') issues.add('UNKNOWN_AUTHOR');
    if (sent && !knownSender) issues.add('UNVERIFIED_ALIAS');
    const recipients = [...email.to, ...email.cc, ...email.bcc];
    const self =
      recipients.length > 0 &&
      recipients.every((entry) => ownAddresses.has(addressKey(entry.address)));
    const direction = sent
      ? self
        ? 'self'
        : 'outgoing'
      : author === 'participant'
        ? 'incoming'
        : 'unknown';
    const chronologicalAt = email.receivedAt ?? email.sentAt;
    const timestampSource = email.receivedAt
      ? 'gmail'
      : email.sentAt
        ? 'header'
        : 'unknown';
    if (timestampSource !== 'gmail') issues.add('UNTRUSTED_CHRONOLOGY');
    if (email.bodyStatus === 'incomplete') issues.add('INCOMPLETE_BODY');
    if (email.warnings.includes('AMBIGUOUS_QUOTE'))
      issues.add('AMBIGUOUS_CONTENT');
    if (
      email.warnings.some(
        (code) =>
          ![
            'AMBIGUOUS_QUOTE',
            'BODY_NOT_LOADED',
            'UNSUPPORTED_BODY',
            'INVALID_BASE64',
            'INVALID_TEXT_ENCODING',
            'UNSUPPORTED_CHARSET',
            'ASSUMED_CHARSET',
          ].includes(code),
      )
    )
      issues.add('INVALID_MESSAGE_METADATA');
    messages.push({
      ...email,
      author,
      direction,
      chronologicalAt,
      timestampSource,
      answeredByMessageIds: [],
      possiblyAnsweredByMessageIds: [],
    });
  }
  const time = (message: ConversationMessage) =>
    message.chronologicalAt ? Date.parse(message.chronologicalAt) : Infinity;
  messages.sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
  for (let i = 1; i < messages.length; i++)
    if (time(messages[i - 1]) === time(messages[i]))
      issues.add('AMBIGUOUS_CHRONOLOGY');
  const messageIdCounts = new Map<string, number>();
  for (const message of messages)
    if (message.internetMessageId) {
      const count = (messageIdCounts.get(message.internetMessageId) ?? 0) + 1;
      messageIdCounts.set(message.internetMessageId, count);
      if (count > 1) issues.add('DUPLICATE_MESSAGE_ID');
    }
  const replyMetadataValid = (message: ConversationMessage) =>
    !message.warnings.some((code) =>
      [
        'MALFORMED_HEADERS',
        'DUPLICATE_HEADERS',
        'INVALID_MESSAGE_ID',
        'INVALID_ADDRESS',
        'AMBIGUOUS_FROM',
      ].includes(code),
    );

  function answers(target: ConversationMessage) {
    const result: string[] = [];
    const possible: string[] = [];
    if (target.author !== 'participant') return { result, possible };
    const recipients = target.replyTo.length ? target.replyTo : target.from;
    for (const response of messages) {
      if (response.direction !== 'outgoing' || time(response) <= time(target))
        continue;
      const addressed =
        recipients.length === 1 &&
        [...response.to, ...response.cc, ...response.bcc].some(
          (entry) =>
            addressKey(entry.address) === addressKey(recipients[0].address),
        );
      const direct =
        !!target.internetMessageId &&
        response.inReplyTo.includes(target.internetMessageId);
      const referenced =
        !!target.internetMessageId &&
        response.references.includes(target.internetMessageId);
      const lastReference =
        referenced &&
        !response.inReplyTo.length &&
        response.references.at(-1) === target.internetMessageId;
      if (
        addressed &&
        (direct || lastReference) &&
        messageIdCounts.get(target.internetMessageId!) === 1 &&
        replyMetadataValid(target) &&
        replyMetadataValid(response) &&
        response.timestampSource === 'gmail' &&
        target.timestampSource === 'gmail'
      )
        result.push(response.id);
      else if (
        direct ||
        referenced ||
        (addressed && !response.inReplyTo.length)
      )
        possible.push(response.id);
    }
    return { result, possible };
  }
  for (let i = 0; i < messages.length; i++) {
    const { result, possible } = answers(messages[i]);
    messages[i] = {
      ...messages[i],
      answeredByMessageIds: result,
      possiblyAnsweredByMessageIds: possible,
    };
  }
  const incoming = messages.filter(
    (message) =>
      message.direction === 'incoming' ||
      (message.author === 'unknown' && message.labels.includes('INBOX')),
  );
  const latest = incoming.at(-1);
  const candidates = incoming.filter((message) =>
    message.labels.includes('INBOX'),
  );
  const targetMessageId =
    input.targetMessageId ?? candidates.at(-1)?.id ?? null;
  const target = messages.find((message) => message.id === targetMessageId);
  if (target && !candidates.some((message) => message.id === target.id))
    issues.add('TARGET_NOT_INCOMING');
  if (targetMessageId && !target) issues.add('TARGET_EXCLUDED');
  if (target && !target.authoredText.trim()) issues.add('EMPTY_TARGET');
  if (target?.possiblyAnsweredByMessageIds.length) issues.add('POSSIBLE_REPLY');
  if (target) {
    const recipients = [...target.to, ...target.cc, ...target.bcc];
    const externalRecipients = recipients.filter(
      (entry) => !ownAddresses.has(addressKey(entry.address)),
    );
    if (
      !recipients.some((entry) =>
        ownAddresses.has(addressKey(entry.address)),
      ) ||
      externalRecipients.length ||
      target.replyTo.length > 1 ||
      (target.replyTo.length === 1 &&
        target.from.length === 1 &&
        addressKey(target.replyTo[0].address) !==
          addressKey(target.from[0].address))
    )
      issues.add('AMBIGUOUS_RECIPIENTS');
  }
  const answeredByMessageIds = target?.answeredByMessageIds ?? [];
  const isAlreadyAnswered = answeredByMessageIds.length > 0;
  const superseded =
    !!target &&
    !!latest &&
    latest.id !== target.id &&
    time(latest) > time(target);
  const hasDraft = drafts.length > 0;
  const status = hasDraft
    ? 'EXISTING_DRAFT'
    : !target || issues.has('TARGET_NOT_INCOMING')
      ? 'NO_CANDIDATE'
      : isAlreadyAnswered
        ? 'ALREADY_ANSWERED'
        : superseded
          ? 'SUPERSEDED'
          : issues.size
            ? 'REVIEW_REQUIRED'
            : 'NEEDS_CLASSIFICATION';
  const participants = new Map<string, EmailAddress & { isOwner: boolean }>();
  for (const message of messages)
    for (const entry of [
      ...message.from,
      ...message.to,
      ...message.cc,
      ...message.bcc,
      ...message.replyTo,
    ]) {
      const key = addressKey(entry.address);
      const existing = participants.get(key);
      participants.set(key, {
        ...entry,
        name: existing?.name || entry.name,
        isOwner: ownAddresses.has(key),
      });
    }
  return {
    accountId: input.accountId,
    threadId: thread.id,
    historyId: thread.historyId ?? null,
    messages,
    participants: [...participants.values()],
    excludedMessageIds,
    drafts,
    hasDraft,
    hasManualDraft: drafts.some((draft) => !draft.isManaged),
    latestIncomingMessageId: latest?.id ?? null,
    targetMessageId,
    pendingMessageIds: candidates
      .filter((message) => !message.answeredByMessageIds.length)
      .map((message) => message.id),
    isAlreadyAnswered,
    answeredByMessageIds,
    possiblyAnsweredByMessageIds: target?.possiblyAnsweredByMessageIds ?? [],
    status,
    issues: [...issues],
  };
}

export async function getThreadContext(
  client: Pick<GmailClient, 'getThread'>,
  input: ConversationInput & { threadId: string },
): Promise<ThreadContext> {
  identity(input);
  if (!safeId(input.threadId)) throw new ConversationError('INVALID_INPUT');
  const thread = await client.getThread(input.threadId, { format: 'full' });
  if (thread.id !== input.threadId)
    throw new ConversationError('INVALID_THREAD');
  return reconstructConversation(thread, input);
}
