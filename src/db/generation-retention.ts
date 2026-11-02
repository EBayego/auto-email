import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import { generationRetentionUpdateSchema } from '@/modules/analytics/generations';
import { assertPrivacyAuthorized } from './privacy';

export function createGenerationRetentionRepository(
  client: DataClient,
  userId: string,
) {
  requireUuid(userId);
  return Object.freeze({
    async get(accountId: string) {
      requireUuid(accountId);
      const owner = createOwnerRepositories(client, userId);
      if (
        requireResource(await owner.users.get()).status !== 'ACTIVE' ||
        requireResource(await owner.gmailAccounts.findById(accountId))
          .status !== 'CONNECTED'
      )
        throw new DataAccessError('FORBIDDEN');
      const { data, error } = await client
        .from('generation_content_authorizations')
        .select('retention_hours,notice_version,authorized_at')
        .eq('user_id', userId)
        .eq('gmail_account_id', accountId)
        .maybeSingle();
      if (error) throw new DataAccessError('UNAVAILABLE');
      return {
        accountId,
        enabled: !!data,
        retentionHours: data?.retention_hours ?? null,
        noticeVersion: data?.notice_version ?? null,
        authorizedAt: data?.authorized_at ?? null,
      };
    },
    async set(raw: unknown) {
      const parsed = generationRetentionUpdateSchema.safeParse(raw);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      const input = parsed.data;
      if (input.enabled) await assertPrivacyAuthorized(client, userId);
      const { error } = await client.rpc('set_generation_retention', {
        p_user_id: userId,
        p_account_id: input.accountId,
        p_enabled: input.enabled,
        p_retention_hours: input.enabled ? input.retentionHours : undefined,
        p_notice_version: input.enabled ? input.noticeVersion : undefined,
      });
      if (error?.message === 'FORBIDDEN')
        throw new DataAccessError('FORBIDDEN');
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
  });
}
