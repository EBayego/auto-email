import type { GmailClient, GmailMessage } from '@/providers/contracts';
import {
  validateWritingProfile,
  type WritingProfile,
} from '@/modules/identity/writing-profile';
import {
  ConversationError,
  reconstructConversation,
  type ConversationInput,
  type ConversationIssue,
  type ThreadContext,
} from './conversation';
import { readEmailHeaders } from './email-headers';
import {
  selectReplyRecipients,
  type ReplyRecipients,
} from './reply-recipients';
import type { StyleScope } from '@/modules/identity/contextual-style';
import {
  validateResolvedStylePreferences,
  type ResolvedStylePreferences,
} from '@/modules/identity/style-preferences';

export type SelectedWritingStyle = Readonly<{
  revision: string;
  profile: WritingProfile;
  scopeKind?: StyleScope['kind'];
  exampleMessageIds?: readonly string[];
}>;

export const manualSelectionLimits = Object.freeze({
  messages: 20,
  contextBytes: 64 * 1024,
});
export type ManualSelectionInput = Omit<
  ConversationInput,
  'managedDraftMessageIds'
> & {
  threadId: string;
  style?: SelectedWritingStyle;
  resolveStyle?: (recipient: string) => Promise<SelectedWritingStyle | null>;
  resolvePreferences?: (recipient: string) => Promise<ResolvedStylePreferences>;
};
export type SelectionStatus =
  | Exclude<ThreadContext['status'], 'NEEDS_CLASSIFICATION'>
  | 'SELECTED'
  | 'FILTERED_OUT';
export type SelectionReason =
  | ConversationIssue
  | Exclude<SelectionStatus, 'SELECTED' | 'FILTERED_OUT'>
  | 'NEWSLETTER'
  | 'AUTOMATED'
  | 'NO_REPLY_ADDRESS'
  | 'LATER_OWNER_MESSAGE'
  | 'UNSUPPORTED_ATTACHMENT'
  | 'CONTEXT_LIMIT_EXCEEDED';
export type ManualSelectionReport = {
  accountId: string;
  threadId: string;
  historyId: string | null;
  targetMessageId: string | null;
  status: SelectionStatus;
  contextPrepared: boolean;
  reasons: SelectionReason[];
  messageCount: number;
  contextMessageCount: number;
  contextBytes: number;
  hasDraft: boolean;
  answeredByMessageIds: readonly string[];
  styleRevision: string | null;
  styleScope?: StyleScope['kind'];
  warnings: 'STYLE_PROFILE_UNAVAILABLE'[];
};

// Routing identifiers and reply headers stay separate from the model's input.
export type PreparedReplyContext = {
  accountId: string;
  threadId: string;
  historyId: string | null;
  targetMessageId: string;
  styleRevision?: string;
  styleExampleMessageIds?: readonly string[];
  styleExampleBefore?: string;
  stylePreferences?: ResolvedStylePreferences;
  messageAudiences?: string[][];
  replyTarget: ReplyRecipients & {
    subject: string | null;
    inReplyTo: string;
    references: string[];
  };
  modelInput: {
    schemaVersion: 1;
    subject: string | null;
    messages: { speaker: string; text: string; isTarget: boolean }[];
    style: WritingProfile | null;
  };
};
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const address = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[^\s<>@]+@[^\s<>@]+$/u.test(value);
export function validateManualSelection(input: ManualSelectionInput) {
  if (
    !input ||
    !id(input.accountId) ||
    !id(input.threadId) ||
    !address(input.mailboxAddress) ||
    (input.resolveStyle !== undefined &&
      typeof input.resolveStyle !== 'function') ||
    (input.resolvePreferences !== undefined &&
      typeof input.resolvePreferences !== 'function') ||
    (input.targetMessageId !== undefined && !id(input.targetMessageId)) ||
    (input.aliases !== undefined &&
      (!Array.isArray(input.aliases) ||
        input.aliases.length > 100 ||
        !input.aliases.every(address))) ||
    (input.style !== undefined &&
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
        input.style.revision,
      ))
  )
    throw new ConversationError('INVALID_INPUT');
  if (input.style) {
    validateWritingProfile(input.style.profile);
    const refs = input.style.exampleMessageIds;
    if (
      refs !== undefined &&
      (!Array.isArray(refs) ||
        refs.length > 500 ||
        refs.some((value) => !id(value)) ||
        new Set(refs).size !== refs.length)
    )
      throw new ConversationError('INVALID_INPUT');
  }
}

function automatedReason(
  raw: GmailMessage,
  sender: string,
  replyTo: readonly { address: string }[],
  subject: string | null,
): SelectionReason | null {
  const headers = readEmailHeaders(raw.payload?.headers, new Set());
  if (
    headers.all('list-id').length ||
    headers.all('list-unsubscribe').length ||
    headers
      .all('precedence')
      .some((value) => /^(?:bulk|junk|list)$/i.test(value))
  )
    return 'NEWSLETTER';
  if (
    headers
      .all('auto-submitted')
      .some((value) => value.toLowerCase().split(';')[0].trim() !== 'no') ||
    ['x-autoreply', 'x-autorespond'].some((name) => headers.all(name).length) ||
    /^(?:(?:re|aw):\s*)*(?:automatic reply|auto(?:matic)?[ -]?response|out of (?:the )?office|respuesta autom[aá]tica|fuera de la oficina|abwesenheitsnotiz)\b/i.test(
      subject ?? '',
    )
  )
    return 'AUTOMATED';
  if (
    [sender, ...replyTo.map((entry) => entry.address)].some((value) =>
      /^(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon)(?:[+._-]|@)/i.test(
        value,
      ),
    )
  )
    return 'NO_REPLY_ADDRESS';
  return null;
}

export async function selectPendingEmail(
  client: Pick<GmailClient, 'getThread'>,
  input: ManualSelectionInput,
  consume?: (context: PreparedReplyContext) => Promise<void>,
): Promise<ManualSelectionReport> {
  validateManualSelection(input);
  const raw = await client.getThread(input.threadId, { format: 'full' });
  if (raw.id !== input.threadId) throw new ConversationError('INVALID_THREAD');
  const conversation = await reconstructConversation(raw, input);
  const report: ManualSelectionReport = {
    accountId: input.accountId,
    threadId: input.threadId,
    historyId: conversation.historyId,
    targetMessageId: conversation.targetMessageId,
    status:
      conversation.status === 'NEEDS_CLASSIFICATION'
        ? 'SELECTED'
        : conversation.status,
    contextPrepared: false,
    reasons: [...conversation.issues],
    messageCount: conversation.messages.length,
    contextMessageCount: 0,
    contextBytes: 0,
    hasDraft: conversation.hasDraft,
    answeredByMessageIds: conversation.answeredByMessageIds,
    styleRevision: input.style?.revision ?? null,
    warnings: input.style ? [] : ['STYLE_PROFILE_UNAVAILABLE'],
  };
  if (report.status !== 'SELECTED' && report.status !== 'FILTERED_OUT')
    report.reasons.push(report.status);
  const target = conversation.messages.find(
    (message) => message.id === report.targetMessageId,
  );
  if (!target || !['SELECTED', 'REVIEW_REQUIRED'].includes(report.status))
    return report;
  const targetRaw = raw.messages.find((message) => message.id === target.id)!;
  const excluded = automatedReason(
    targetRaw,
    target.from[0]?.address ?? '',
    target.replyTo,
    target.subject,
  );
  if (excluded) {
    report.status = 'FILTERED_OUT';
    report.reasons.push(excluded);
    return report;
  }
  if (report.status !== 'SELECTED') return report;
  const review = (reason: SelectionReason) => {
    report.status = 'REVIEW_REQUIRED';
    report.reasons.push(reason);
  };
  // A later SENT with different reply headers is not proof of an answer. Require
  // review rather than declaring that the user's last incoming message is pending.
  if (
    conversation.messages.some(
      (message) =>
        message.author === 'owner' &&
        Date.parse(message.chronologicalAt!) >
          Date.parse(target.chronologicalAt!),
    )
  )
    review('LATER_OWNER_MESSAGE');
  if (target.attachments.some((attachment) => !attachment.inline))
    review('UNSUPPORTED_ATTACHMENT');
  const relevant = conversation.messages.filter((message) =>
    message.authoredText.trim(),
  );
  if (relevant.length > manualSelectionLimits.messages)
    review('CONTEXT_LIMIT_EXCEEDED');
  if (report.status !== 'SELECTED') return report;
  const style = input.resolveStyle
    ? ((await input.resolveStyle(target.from[0].address)) ?? input.style)
    : input.style;
  if (style)
    validateManualSelection({ ...input, style, resolveStyle: undefined });
  report.styleRevision = style?.revision ?? null;
  report.warnings = style ? [] : ['STYLE_PROFILE_UNAVAILABLE'];
  if (style?.scopeKind) report.styleScope = style.scopeKind;
  const speakers = new Map<string, string>();
  const messages = relevant.map((message) => {
    const sender = message.from[0].address.toLowerCase();
    let speaker = 'owner';
    if (message.author !== 'owner') {
      if (!speakers.has(sender))
        speakers.set(sender, `participant_${speakers.size + 1}`);
      speaker = speakers.get(sender)!;
    }
    return {
      speaker,
      text: message.authoredText,
      isTarget: message.id === target.id,
    };
  });
  const modelInput: PreparedReplyContext['modelInput'] = {
    schemaVersion: 1,
    subject: target.subject,
    messages,
    style: style ? validateWritingProfile(style.profile) : null,
  };
  try {
    const bytes = Buffer.byteLength(JSON.stringify(modelInput));
    if (bytes > manualSelectionLimits.contextBytes) {
      review('CONTEXT_LIMIT_EXCEEDED');
      return report;
    }
    report.contextMessageCount = messages.length;
    report.contextBytes = bytes;
    const context: PreparedReplyContext = {
      accountId: input.accountId,
      threadId: input.threadId,
      historyId: conversation.historyId,
      targetMessageId: target.id,
      messageAudiences: relevant.map((message) => [
        ...new Set(
          [...message.from, ...message.to, ...message.cc].map((a) =>
            a.address.toLowerCase(),
          ),
        ),
      ]),
      styleExampleBefore: target.chronologicalAt!,
      ...(input.resolvePreferences
        ? {
            stylePreferences: validateResolvedStylePreferences(
              await input.resolvePreferences(target.from[0].address),
            ),
          }
        : {}),
      ...(input.resolveStyle && style ? { styleRevision: style.revision } : {}),
      ...(style?.exampleMessageIds
        ? { styleExampleMessageIds: [...style.exampleMessageIds] }
        : {}),
      replyTarget: {
        ...selectReplyRecipients(target, input)!,
        subject: target.subject,
        inReplyTo: target.internetMessageId!,
        references: [
          ...new Set([...target.references, target.internetMessageId!]),
        ],
      },
      modelInput,
    };
    if (consume) await consume(context);
    report.contextPrepared = true;
    return report;
  } finally {
    // Bodies remain scoped to this processing callback, including on failure.
    messages.length = 0;
  }
}
