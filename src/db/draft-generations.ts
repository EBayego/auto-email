import type { DataClient } from './models';
import type { Tables } from './database.types';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import type {
  DraftRecord,
  DraftReservation,
  DraftStore,
} from '@/modules/gmail/draft-contracts';
import { responsePromptVersion } from '@/modules/response/prompts';

const columns =
  'id,user_id,gmail_account_id,thread_id,target_message_id,status,draft_id,draft_message_id,verified_at';
const id = (value: string) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
export function createDraftGenerationRepository(
  client: DataClient,
  userId: string,
  accountId: string,
): DraftStore {
  requireUuid(userId);
  requireUuid(accountId);
  const authorize = async () => {
    const owner = createOwnerRepositories(client, userId);
    if ((await owner.users.get())?.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
    if (
      requireResource(await owner.gmailAccounts.findById(accountId)).status !==
      'CONNECTED'
    )
      throw new DataAccessError('FORBIDDEN');
  };
  const checked = (
    row: Pick<
      Tables<'draft_generations'>,
      | 'id'
      | 'user_id'
      | 'gmail_account_id'
      | 'thread_id'
      | 'target_message_id'
      | 'status'
      | 'draft_id'
      | 'draft_message_id'
      | 'verified_at'
    > | null,
  ): DraftRecord | null => {
    if (!row) return null;
    if (
      row.user_id !== userId ||
      row.gmail_account_id !== accountId ||
      !['CREATING', 'CREATED', 'UNCERTAIN', 'CANCELLED'].includes(row.status)
    )
      throw new DataAccessError('UNAVAILABLE');
    return {
      id: row.id,
      threadId: row.thread_id,
      targetMessageId: row.target_message_id,
      status: row.status as DraftRecord['status'],
      draftId: row.draft_id,
      draftMessageId: row.draft_message_id,
      verified: row.verified_at !== null,
    };
  };
  const scoped = () =>
    client
      .from('draft_generations')
      .select(columns)
      .eq('user_id', userId)
      .eq('gmail_account_id', accountId);
  const find = async (target: string) => {
    if (!id(target)) throw new DataAccessError('INVALID_INPUT');
    await authorize();
    const { data, error } = await scoped()
      .eq('target_message_id', target)
      .maybeSingle();
    if (error) throw new DataAccessError('UNAVAILABLE');
    const row = checked(data);
    if (row && row.targetMessageId !== target)
      throw new DataAccessError('UNAVAILABLE');
    return row;
  };
  const update = async (
    attempt: string,
    values: Partial<Tables<'draft_generations'>>,
    state: string,
  ) => {
    requireUuid(attempt);
    await authorize();
    const { data, error } = await client
      .from('draft_generations')
      .update(values)
      .eq('user_id', userId)
      .eq('gmail_account_id', accountId)
      .eq('id', attempt)
      .eq('status', state)
      .select(columns)
      .maybeSingle();
    if (error || requireResource(checked(data)).id !== attempt)
      throw new DataAccessError('UNAVAILABLE');
  };
  return Object.freeze<DraftStore>({
    find,
    async reserve(input: DraftReservation) {
      requireUuid(input.id);
      requireUuid(input.styleRevision);
      if (
        !id(input.threadId) ||
        !id(input.targetMessageId) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.model) ||
        ![input.inputTokens, input.outputTokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647,
        )
      )
        throw new DataAccessError('INVALID_INPUT');
      await authorize();
      const { data, error } = await client
        .from('draft_generations')
        .insert({
          id: input.id,
          user_id: userId,
          gmail_account_id: accountId,
          thread_id: input.threadId,
          target_message_id: input.targetMessageId,
          style_revision: input.styleRevision,
          model: input.model,
          prompt_version: responsePromptVersion,
          input_tokens: input.inputTokens,
          output_tokens: input.outputTokens,
        })
        .select(columns)
        .single();
      if (!error) {
        const record = requireResource(checked(data));
        if (
          record.id !== input.id ||
          record.targetMessageId !== input.targetMessageId ||
          record.threadId !== input.threadId ||
          record.status !== 'CREATING'
        )
          throw new DataAccessError('UNAVAILABLE');
        return { acquired: true, record };
      }
      if (error.code !== '23505') throw new DataAccessError('UNAVAILABLE');
      // Both uniqueness constraints arbitrate concurrent processes in Postgres.
      let record = await find(input.targetMessageId);
      if (!record) {
        const result = await scoped()
          .eq('thread_id', input.threadId)
          .in('status', ['CREATING', 'UNCERTAIN'])
          .maybeSingle();
        if (result.error) throw new DataAccessError('UNAVAILABLE');
        record = checked(result.data);
      }
      if (!record || record.threadId !== input.threadId)
        throw new DataAccessError('UNAVAILABLE');
      return { acquired: false, record };
    },
    async created(attempt, draftId, messageId) {
      if (!id(draftId) || !id(messageId))
        throw new DataAccessError('INVALID_INPUT');
      await update(
        attempt,
        { status: 'CREATED', draft_id: draftId, draft_message_id: messageId },
        'CREATING',
      );
    },
    async verified(attempt) {
      await update(
        attempt,
        { verified_at: new Date().toISOString() },
        'CREATED',
      );
    },
    async stop(attempt, status, reason, identifiers) {
      if (
        !['UNCERTAIN', 'CANCELLED'].includes(status) ||
        ![
          'THREAD_CHANGED',
          'PREWRITE_FAILED',
          'GMAIL_WRITE_UNCERTAIN',
          'PERSISTENCE_FAILED',
          'VERIFICATION_FAILED',
        ].includes(reason) ||
        (status === 'CANCELLED' &&
          !['THREAD_CHANGED', 'PREWRITE_FAILED'].includes(reason)) ||
        (identifiers &&
          (status !== 'UNCERTAIN' ||
            [identifiers.draftId, identifiers.draftMessageId].some(
              (value) => value !== null && !id(value),
            )))
      )
        throw new DataAccessError('INVALID_INPUT');
      await update(
        attempt,
        {
          status,
          reason_code: reason,
          ...(identifiers
            ? {
                draft_id: identifiers.draftId,
                draft_message_id: identifiers.draftMessageId,
              }
            : {}),
        },
        'CREATING',
      );
    },
  });
}
