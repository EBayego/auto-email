import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import type { KnownDraftAttempt } from '@/modules/gmail/intervention';

export function createInterventionHistoryRepository(
  client: DataClient,
  userId: string,
  accountId: string,
) {
  requireUuid(userId);
  requireUuid(accountId);
  return Object.freeze({
    async forThread(threadId: string): Promise<readonly KnownDraftAttempt[]> {
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(threadId))
        throw new DataAccessError('INVALID_INPUT');
      const owner = createOwnerRepositories(client, userId);
      if (
        (await owner.users.get())?.status !== 'ACTIVE' ||
        requireResource(await owner.gmailAccounts.findById(accountId))
          .status !== 'CONNECTED'
      )
        throw new DataAccessError('FORBIDDEN');
      const [drafts, jobs] = await Promise.all([
        client
          .from('draft_generations')
          .select(
            'user_id,gmail_account_id,target_message_id,thread_id,status,draft_id,draft_message_id',
          )
          .eq('user_id', userId)
          .eq('gmail_account_id', accountId)
          .eq('thread_id', threadId)
          .limit(101),
        client
          .from('email_jobs')
          .select(
            'user_id,gmail_account_id,target_message_id,thread_id,draft_id',
          )
          .eq('user_id', userId)
          .eq('gmail_account_id', accountId)
          .eq('thread_id', threadId)
          .eq('status', 'DRAFT_CREATED')
          .limit(101),
      ]);
      if (
        drafts.error ||
        jobs.error ||
        !drafts.data ||
        !jobs.data ||
        drafts.data.length + jobs.data.length > 100
      )
        throw new DataAccessError('UNAVAILABLE');
      if (
        [...drafts.data, ...jobs.data].some(
          (row) =>
            row.user_id !== userId ||
            row.gmail_account_id !== accountId ||
            row.thread_id !== threadId,
        )
      )
        throw new DataAccessError('UNAVAILABLE');
      return [
        ...drafts.data.map((draft): KnownDraftAttempt => {
          if (
            !['CREATING', 'CREATED', 'UNCERTAIN', 'CANCELLED'].includes(
              draft.status,
            )
          )
            throw new DataAccessError('UNAVAILABLE');
          return {
            targetMessageId: draft.target_message_id,
            threadId: draft.thread_id,
            status: draft.status as KnownDraftAttempt['status'],
            draftId: draft.draft_id,
            draftMessageId: draft.draft_message_id,
          };
        }),
        ...jobs.data.map((job): KnownDraftAttempt => ({
          targetMessageId: job.target_message_id,
          threadId: job.thread_id,
          status: 'CREATED',
          draftId: job.draft_id,
          draftMessageId: null,
        })),
      ];
    },
  });
}
