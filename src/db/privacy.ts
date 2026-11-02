import type { DataClient } from './models';
import { assertAccountNotErased } from '@/modules/security/erasure-ledger';
import { DataAccessError, requireUuid } from './errors';
import {
  readPrivacyNotice,
  requirePrivacyNotice,
} from '@/modules/privacy/config';
import {
  PrivacyError,
  privacyOperationSchema,
  type PrivacyOperation,
  type PrivacyStatus,
} from '@/modules/privacy/notice';

export async function assertPrivacyAuthorized(
  client: DataClient,
  userId: string,
) {
  requireUuid(userId);
  await assertAccountNotErased(userId);
  const notice = requirePrivacyNotice();
  const { data, error } = await client.rpc('privacy_authorization_valid', {
    p_user_id: userId,
    p_notice_hash: notice.hash,
  });
  if (error) throw new DataAccessError('UNAVAILABLE');
  if (data !== true) throw new PrivacyError('PRIVACY_CONSENT_REQUIRED');
}

export async function enforcePrivacyConfiguration(client: DataClient) {
  const notice = readPrivacyNotice();
  const { data, error } = await client.rpc('enforce_privacy_configuration', {
    p_notice_hash: notice.ready ? notice.hash : undefined,
  });
  if (error || data !== true) throw new DataAccessError('UNAVAILABLE');
}

export function createPrivacyRepository(client: DataClient, userId: string) {
  requireUuid(userId);
  return Object.freeze({
    async get(): Promise<PrivacyStatus> {
      const notice = readPrivacyNotice();
      const [current, events] = await Promise.all([
        client
          .from('privacy_authorizations')
          .select('notice_version,notice_hash,accepted_at,withdrawn_at')
          .eq('user_id', userId)
          .maybeSingle(),
        client
          .from('privacy_events')
          .select('id,action,notice_version,created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (current.error || events.error)
        throw new DataAccessError('UNAVAILABLE');
      const row = current.data;
      return {
        authorized: !!(
          notice.ready &&
          row &&
          !row.withdrawn_at &&
          row.notice_version === notice.version &&
          row.notice_hash === notice.hash
        ),
        acceptedAt: row?.accepted_at ?? null,
        withdrawnAt: row?.withdrawn_at ?? null,
        version: row?.notice_version ?? null,
        events: events.data ?? [],
      };
    },
    async apply(operation: PrivacyOperation) {
      const parsed = privacyOperationSchema.safeParse(operation);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      operation = parsed.data;
      if (operation.action === 'grant') {
        const notice = requirePrivacyNotice();
        if (
          operation.version !== notice.version ||
          operation.noticeHash !== notice.hash
        )
          throw new PrivacyError('STALE_PRIVACY_NOTICE');
        const { data, error } = await client.rpc(
          'grant_privacy_authorization',
          {
            p_user_id: userId,
            p_version: notice.version,
            p_notice_hash: notice.hash,
            p_notice_text: notice.snapshot,
          },
        );
        if (error || data !== true)
          throw new DataAccessError(
            error?.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAVAILABLE',
          );
      } else {
        const { data, error } = await client.rpc(
          'withdraw_privacy_authorization',
          { p_user_id: userId },
        );
        if (error || data !== true)
          throw new DataAccessError(
            error?.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAVAILABLE',
          );
      }
    },
  });
}
