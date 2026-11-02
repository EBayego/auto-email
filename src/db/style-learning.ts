import type { DataClient } from './models';
import { requireUuid, DataAccessError } from './errors';
import {
  assertPrivacyAuthorized,
  enforcePrivacyConfiguration,
} from './privacy';
import {
  StyleLearningError,
  styleLearningOperationSchema,
  styleLearningSnapshotSchema,
} from '@/modules/identity/style-learning';
export function createStyleLearningRepository(
  client: DataClient,
  userId: string,
  accountId: string,
) {
  requireUuid(userId);
  requireUuid(accountId);
  const checked = (error: { message: string } | null) => {
    if (!error) return;
    if (error.message === 'FORBIDDEN') throw new DataAccessError('FORBIDDEN');
    throw new StyleLearningError(
      [
        'INVALID_INPUT',
        'STALE_STYLE',
        'INSUFFICIENT_EVIDENCE',
        'NOT_CONNECTED',
        'NOT_FOUND',
      ].includes(error.message)
        ? error.message
        : 'UNAVAILABLE',
    );
  };
  return Object.freeze({
    async get() {
      const { data, error } = await client.rpc('get_style_learning', {
        p_user_id: userId,
        p_account_id: accountId,
      });
      checked(error);
      const parsed = styleLearningSnapshotSchema.safeParse(data);
      if (!parsed.success) throw new StyleLearningError('UNAVAILABLE');
      return parsed.data;
    },
    async apply(raw: unknown) {
      const parsed = styleLearningOperationSchema.safeParse(raw);
      if (!parsed.success) throw new StyleLearningError('INVALID_INPUT');
      const operation = parsed.data;
      if (operation.action !== 'settings' || operation.enabled)
        await assertPrivacyAuthorized(client, userId);
      if (operation.action === 'settings') {
        const { error } = await client.rpc('set_style_learning_settings', {
          p_user_id: userId,
          p_account_id: accountId,
          p_enabled: operation.enabled,
          p_expected_revision: operation.expectedRevision ?? undefined,
          p_notice_version: operation.noticeVersion,
        });
        checked(error);
      } else {
        const { error } = await client.rpc('decide_style_learning', {
          p_user_id: userId,
          p_account_id: accountId,
          p_proposal_id: operation.proposalId,
          p_expected_revision: operation.expectedRevision,
          p_action: operation.action.toUpperCase(),
        });
        checked(error);
      }
    },
  });
}
export function createStyleLearningWorkerStore(client: DataClient) {
  return Object.freeze({
    async refresh(limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new DataAccessError('INVALID_INPUT');
      await enforcePrivacyConfiguration(client);
      const { error } = await client.rpc('refresh_style_learning', {
        p_limit: limit,
      });
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
  });
}
