import type { DataClient } from '@/db/models';
import { requirePrivacyNotice } from '@/modules/privacy/config';

export async function grantTestPrivacy(client: DataClient, userId: string) {
  if (process.env.AUTO_EMAIL_TEST_URL !== 'http://127.0.0.1:55321')
    throw new Error('Solo pruebas locales');
  const notice = requirePrivacyNotice();
  const result = await client.rpc('grant_privacy_authorization', {
    p_user_id: userId,
    p_version: notice.version,
    p_notice_hash: notice.hash,
    p_notice_text: notice.snapshot,
  });
  if (result.error || result.data !== true)
    throw new Error('No se pudo autorizar la cuenta sintética');
}

// Regression fixtures explicitly start with an authorized owner. MAIL-061 tests
// create unconsented users directly and exercise the actual consent endpoint.
export async function createAuthorizedTestUser(
  client: DataClient,
  attributes: Parameters<DataClient['auth']['admin']['createUser']>[0],
) {
  const result = await client.auth.admin.createUser(attributes);
  if (!result.error && result.data.user)
    await grantTestPrivacy(client, result.data.user.id);
  return result;
}
