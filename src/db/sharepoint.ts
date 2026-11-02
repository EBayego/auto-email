import type { DataClient } from './models';
import type { Json } from './database.types';
import { requireUuid } from './errors';
import {
  SharePointError,
  type SharePointStore,
} from '@/modules/sharepoint/contracts';
import { assertAccountNotErased } from '@/modules/security/erasure-ledger';
import { assertPrivacyAuthorized } from './privacy';
import { requirePrivacyNotice } from '@/modules/privacy/config';

const processing = new Set([
  'oauth_put',
  'oauth_take',
  'connection_save',
  'token_acquire',
  'token_save',
  'assert_read',
  'create',
  'page',
  'pending',
  'cached_hash',
  'document_unchanged',
  'document_save',
  'heartbeat',
  'document_meta',
  'ocr_reserve',
]);

export function createSharePointStore(
  client: DataClient,
  userId: string | null,
): SharePointStore {
  if (userId) requireUuid(userId);
  return {
    async command<T>(
      action: string,
      input: Record<string, unknown> = {},
    ): Promise<T> {
      if (userId) await assertAccountNotErased(userId);
      if (userId && processing.has(action))
        await assertPrivacyAuthorized(client, userId);
      if (action === 'claim')
        input = { ...input, noticeHash: requirePrivacyNotice().hash };
      if (!userId && action !== 'claim')
        throw new SharePointError('CONNECTOR_OWNER_UNAVAILABLE');
      const { data, error } = await client.rpc('sharepoint_command', {
        p_user_id: userId!,
        p_action: action,
        p_input: input as Json,
      });
      if (error) {
        const allowed = [
          'CONNECTOR_NOT_FOUND',
          'CONNECTOR_OWNER_UNAVAILABLE',
          'INVALID_OAUTH_STATE',
          'REAUTH_REQUIRED',
          'TOKEN_BUSY',
          'CONNECTOR_LIMIT',
          'OCR_DAILY_BUDGET',
          'AUDIENCE_CONFLICT',
          'OVERLAPPING_ROOTS',
          'CONNECTOR_LEASE_LOST',
          'ROOT_UNAVAILABLE',
          'PRIVACY_CONSENT_REQUIRED',
        ];
        throw new SharePointError(
          allowed.includes(error.message)
            ? error.message
            : 'CONNECTOR_UNAVAILABLE',
        );
      }
      return data as T;
    },
  };
}
