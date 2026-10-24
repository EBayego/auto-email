import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import {
  executionSettingsSchema,
  type ExecutionSettings,
} from '@/modules/workflow/execution-controls';

export function createExecutionControlRepository(
  client: DataClient,
  userId: string,
) {
  requireUuid(userId);
  const owner = createOwnerRepositories(client, userId);
  const active = async () => {
    if ((await owner.users.get())?.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
  };
  const result = async (
    query: PromiseLike<{ data: boolean | null; error: unknown }>,
  ) => {
    const { data, error } = await query;
    if (error) throw new DataAccessError('UNAVAILABLE');
    if (data !== true) throw new DataAccessError('FORBIDDEN');
  };
  return Object.freeze({
    async settings(settings: ExecutionSettings) {
      const parsed = executionSettingsSchema.safeParse(settings);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      await active();
      await result(
        client.rpc('set_automation_settings', {
          p_user_id: userId,
          p_enabled: parsed.data.automationEnabled,
          p_poll_seconds: parsed.data.pollIntervalSeconds,
          p_daily_limit: parsed.data.maxDailyDrafts,
        }),
      );
    },
    async account(action: 'pause' | 'resume' | 'run') {
      if (!['pause', 'resume', 'run'].includes(action))
        throw new DataAccessError('INVALID_INPUT');
      await active();
      const account = requireResource(await owner.gmailAccounts.get());
      if (action === 'run')
        await result(
          client.rpc('request_manual_processing', {
            p_user_id: userId,
            p_account_id: account.id,
          }),
        );
      else
        await result(
          client.rpc('set_gmail_processing_paused', {
            p_user_id: userId,
            p_account_id: account.id,
            p_paused: action === 'pause',
          }),
        );
    },
  });
}

export async function assertExecutionAllowed(
  client: DataClient,
  work: { userId: string; gmailAccountId: string },
) {
  requireUuid(work.userId);
  requireUuid(work.gmailAccountId);
  const { data, error } = await client.rpc('gmail_execution_allowed', {
    p_user_id: work.userId,
    p_account_id: work.gmailAccountId,
  });
  if (error) throw new DataAccessError('UNAVAILABLE');
  if (data !== true) throw new DataAccessError('FORBIDDEN');
}
