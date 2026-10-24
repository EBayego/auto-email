import { z } from 'zod';
import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import {
  normalizeResponsePolicySettings,
  responsePolicySettingsSchema,
  responsePolicyEvaluationSchema,
  type ResponsePolicySettings,
} from '@/modules/policy/settings';
import type { ResponsePolicyAccess } from '@/modules/policy/access';

const snapshotSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  settings: responsePolicySettingsSchema,
});
export function createResponsePolicyRepository(
  client: DataClient,
  userId: string,
) {
  requireUuid(userId);
  const owner = createOwnerRepositories(client, userId);
  const active = async () => {
    if ((await owner.users.get())?.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
  };
  const get = async () => {
    await active();
    const { data, error } = await client.rpc('get_response_policy', {
      p_user_id: userId,
    });
    const parsed = snapshotSchema.safeParse(data);
    if (error || !parsed.success) throw new DataAccessError('UNAVAILABLE');
    return parsed.data;
  };
  return Object.freeze({
    get,
    async set(input: ResponsePolicySettings) {
      let settings: ResponsePolicySettings;
      try {
        settings = normalizeResponsePolicySettings(input);
      } catch {
        throw new DataAccessError('INVALID_INPUT');
      }
      await active();
      const { data, error } = await client.rpc('set_response_policy', {
        p_user_id: userId,
        p_settings: settings,
      });
      if (error?.code === '23514') throw new DataAccessError('INVALID_INPUT');
      if (error) throw new DataAccessError('UNAVAILABLE');
      if (!data) throw new DataAccessError('FORBIDDEN');
      return get();
    },
    forAccount(accountId: string): ResponsePolicyAccess {
      requireUuid(accountId);
      const authorize = async (
        context: Parameters<ResponsePolicyAccess['load']>[0],
      ) => {
        if (
          context.accountId !== accountId ||
          !/^[A-Za-z0-9_-]{1,512}$/.test(context.threadId) ||
          !/^[A-Za-z0-9_-]{1,512}$/.test(context.targetMessageId)
        )
          throw new DataAccessError('INVALID_INPUT');
        await active();
        if (
          requireResource(await owner.gmailAccounts.findById(accountId))
            .status !== 'CONNECTED'
        )
          throw new DataAccessError('FORBIDDEN');
      };
      return Object.freeze({
        async load(context: Parameters<ResponsePolicyAccess['load']>[0]) {
          await authorize(context);
          return get();
        },
        async record(
          context: Parameters<ResponsePolicyAccess['record']>[0],
          evaluation: Parameters<ResponsePolicyAccess['record']>[1],
          evaluationId: string,
          revision: string,
        ) {
          requireUuid(evaluationId);
          const parsed = responsePolicyEvaluationSchema.safeParse(evaluation);
          if (!parsed.success || !/^[a-f0-9]{32}$/.test(revision))
            throw new DataAccessError('INVALID_INPUT');
          await authorize(context);
          const { error } = await client.from('response_policy_events').insert({
            user_id: userId,
            gmail_account_id: accountId,
            evaluation_id: evaluationId,
            thread_id: context.threadId,
            target_message_id: context.targetMessageId,
            engine_version: parsed.data.version,
            phase: parsed.data.phase,
            action: parsed.data.action,
            reasons: parsed.data.reasons,
            policy_revision: revision,
          });
          if (error) throw new DataAccessError('UNAVAILABLE');
        },
      });
    },
  });
}
