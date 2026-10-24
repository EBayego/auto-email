import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import {
  factualAuditSchema,
  type FactualValidationAccess,
} from '@/modules/response/factual-validation';

export function createResponseValidationRepository(
  client: DataClient,
  userId: string,
  accountId: string,
): FactualValidationAccess {
  requireUuid(userId);
  requireUuid(accountId);
  const owner = createOwnerRepositories(client, userId);
  return Object.freeze<FactualValidationAccess>({
    async record(context, validation, evaluationId) {
      requireUuid(evaluationId);
      const parsed = factualAuditSchema.safeParse(validation);
      if (
        !parsed.success ||
        context.accountId !== accountId ||
        ![context.threadId, context.targetMessageId].every((id) =>
          /^[A-Za-z0-9_-]{1,512}$/.test(id),
        )
      )
        throw new DataAccessError('INVALID_INPUT');
      if (
        (await owner.users.get())?.status !== 'ACTIVE' ||
        requireResource(await owner.gmailAccounts.findById(accountId))
          .status !== 'CONNECTED'
      )
        throw new DataAccessError('FORBIDDEN');
      const { error } = await client.from('response_validation_events').insert({
        user_id: userId,
        gmail_account_id: accountId,
        evaluation_id: evaluationId,
        thread_id: context.threadId,
        target_message_id: context.targetMessageId,
        validation: parsed.data,
      });
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
  });
}
