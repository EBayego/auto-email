import type { GmailClient, GmailThread } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { ConversationError, reconstructConversation } from './conversation';

export type KnownDraftAttempt = Readonly<{
  targetMessageId: string;
  threadId: string;
  status: 'CREATING' | 'CREATED' | 'UNCERTAIN' | 'CANCELLED';
  draftId: string | null;
  draftMessageId: string | null;
}>;
export const interventionSkipReasons = [
  'EXISTING_MANUAL_DRAFT',
  'EXISTING_SYSTEM_DRAFT',
  'TARGET_ALREADY_PROCESSED',
  'ALREADY_ANSWERED',
  'TARGET_SUPERSEDED',
  'TARGET_NOT_ELIGIBLE',
] as const;
export const interventionReviewReasons = [
  'DRAFT_RECONCILIATION_REQUIRED',
  'DRAFT_ATTEMPT_CANCELLED',
  'POSSIBLE_EXISTING_REPLY',
  'THREAD_UNVERIFIABLE',
] as const;
export type InterventionDecision =
  | { status: 'CONTINUE' }
  | { status: 'SKIPPED'; reasonCode: (typeof interventionSkipReasons)[number] }
  | {
      status: 'REVIEW_REQUIRED';
      reasonCode: (typeof interventionReviewReasons)[number];
    };

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const review = (): InterventionDecision => ({
  status: 'REVIEW_REQUIRED',
  reasonCode: 'THREAD_UNVERIFIABLE',
});

// Gmail draft message IDs can change after editing. Only persisted IDs establish
// provenance; mail headers and model output never establish that a draft is ours.
async function managedDrafts(
  gmail: Pick<GmailClient, 'get'>,
  thread: GmailThread,
  attempts: readonly KnownDraftAttempt[],
) {
  const known = new Set<string>();
  const resolved = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.status === 'CANCELLED') continue;
    if (attempt.draftMessageId) known.add(attempt.draftMessageId);
    if (!attempt.draftId || resolved.has(attempt.draftId)) continue;
    resolved.add(attempt.draftId);
    let value: unknown;
    try {
      value = await gmail.get(`drafts/${attempt.draftId}`, {
        format: 'minimal',
      });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'NOT_FOUND')
        continue;
      throw error;
    }
    const draft = value as {
      id?: unknown;
      message?: { id?: unknown; threadId?: unknown };
    } | null;
    if (
      !draft ||
      draft.id !== attempt.draftId ||
      !safeId(draft.message?.id) ||
      draft.message.threadId !== thread.id
    )
      throw new ProviderError('google', 'INVALID_RESPONSE');
    known.add(draft.message.id);
  }
  return known;
}

export async function checkEmailIntervention(input: {
  gmail: Pick<GmailClient, 'getThread' | 'get'>;
  accountId: string;
  mailboxAddress: string;
  threadId: string;
  targetMessageId: string;
  attempts: readonly KnownDraftAttempt[];
}): Promise<InterventionDecision> {
  if (
    !safeId(input.accountId) ||
    !/^[^\s<>@]+@[^\s<>@]+$/u.test(input.mailboxAddress) ||
    !safeId(input.threadId) ||
    !safeId(input.targetMessageId) ||
    input.attempts.length > 100 ||
    input.attempts.some(
      (attempt) =>
        !['CREATING', 'CREATED', 'UNCERTAIN', 'CANCELLED'].includes(
          attempt.status,
        ) ||
        attempt.threadId !== input.threadId ||
        !safeId(attempt.targetMessageId) ||
        (attempt.draftId !== null && !safeId(attempt.draftId)) ||
        (attempt.draftMessageId !== null && !safeId(attempt.draftMessageId)),
    )
  )
    throw new ConversationError('INVALID_INPUT');
  const thread = await input.gmail.getThread(input.threadId, {
    format: 'full',
  });
  if (thread.id !== input.threadId) return review();
  const drafts = thread.messages.filter((message) =>
    message.labelIds?.includes('DRAFT'),
  );
  if (drafts.length) {
    const known = await managedDrafts(input.gmail, thread, input.attempts);
    return {
      status: 'SKIPPED',
      reasonCode: drafts.some((draft) => !known.has(draft.id))
        ? 'EXISTING_MANUAL_DRAFT'
        : 'EXISTING_SYSTEM_DRAFT',
    };
  }
  const previous = input.attempts.find(
    (attempt) =>
      attempt.targetMessageId === input.targetMessageId &&
      attempt.status === 'CREATED',
  );
  if (previous)
    return { status: 'SKIPPED', reasonCode: 'TARGET_ALREADY_PROCESSED' };
  if (
    input.attempts.some((attempt) =>
      ['CREATING', 'UNCERTAIN'].includes(attempt.status),
    )
  )
    return {
      status: 'REVIEW_REQUIRED',
      reasonCode: 'DRAFT_RECONCILIATION_REQUIRED',
    };
  if (
    input.attempts.some(
      (attempt) =>
        attempt.targetMessageId === input.targetMessageId &&
        attempt.status === 'CANCELLED',
    )
  )
    return { status: 'REVIEW_REQUIRED', reasonCode: 'DRAFT_ATTEMPT_CANCELLED' };
  try {
    const context = await reconstructConversation(thread, {
      accountId: input.accountId,
      mailboxAddress: input.mailboxAddress,
      targetMessageId: input.targetMessageId,
    });
    if (context.isAlreadyAnswered)
      return { status: 'SKIPPED', reasonCode: 'ALREADY_ANSWERED' };
    if (context.possiblyAnsweredByMessageIds.length)
      return {
        status: 'REVIEW_REQUIRED',
        reasonCode: 'POSSIBLE_EXISTING_REPLY',
      };
    if (context.status === 'SUPERSEDED' && context.issues.length)
      return review();
    if (context.status === 'SUPERSEDED')
      return { status: 'SKIPPED', reasonCode: 'TARGET_SUPERSEDED' };
    if (context.status === 'NO_CANDIDATE')
      return { status: 'SKIPPED', reasonCode: 'TARGET_NOT_ELIGIBLE' };
    return context.status === 'NEEDS_CLASSIFICATION'
      ? { status: 'CONTINUE' }
      : review();
  } catch (error) {
    if (error instanceof ConversationError) return review();
    throw error;
  }
}
