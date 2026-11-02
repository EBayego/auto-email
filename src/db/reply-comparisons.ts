import type { DataClient } from './models';
import type { Json } from './database.types';
import { DataAccessError } from './errors';
import { z } from 'zod';
import {
  assertPrivacyAuthorized,
  enforcePrivacyConfiguration,
} from './privacy';
import {
  comparisonResolutionSchema,
  replyComparisonTaskSchema,
  type ReplyComparisonStore,
  type ReplyComparisonTask,
  type ComparisonResolution,
} from '@/modules/analytics/comparison-work';
export function createReplyComparisonStore(
  client: DataClient,
): ReplyComparisonStore {
  const scope = (task: ReplyComparisonTask) => {
    const value = replyComparisonTaskSchema.safeParse(task);
    if (!value.success) throw new DataAccessError('INVALID_INPUT');
    return {
      p_user_id: value.data.userId,
      p_account_id: value.data.gmailAccountId,
      p_feedback_id: value.data.id,
      p_lease_id: value.data.leaseId,
    };
  };
  return Object.freeze({
    async claim(limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new DataAccessError('INVALID_INPUT');
      await enforcePrivacyConfiguration(client);
      const { data, error } = await client.rpc('claim_reply_comparisons', {
        p_limit: limit,
        p_lease_seconds: 120,
      });
      const parsed = z
        .array(replyComparisonTaskSchema)
        .max(limit)
        .safeParse(data);
      if (error || !parsed.success) throw new DataAccessError('UNAVAILABLE');
      return parsed.data;
    },
    async loadOriginal(task: ReplyComparisonTask) {
      scope(task);
      await assertPrivacyAuthorized(client, task.userId);
      const { data, error } = await client.rpc(
        'load_reply_comparison_original',
        scope(task),
      );
      if (error || (data !== null && typeof data !== 'string'))
        throw new DataAccessError('UNAVAILABLE');
      return data;
    },
    async finish(task: ReplyComparisonTask, result: ComparisonResolution) {
      const parsed = comparisonResolutionSchema.safeParse(result);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client.rpc('finish_reply_comparison', {
        ...scope(task),
        p_result: parsed.data as Json,
      });
      if (error || typeof data !== 'boolean')
        throw new DataAccessError('UNAVAILABLE');
      return data;
    },
  });
}
