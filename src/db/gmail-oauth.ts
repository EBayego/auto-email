import 'server-only';
import { getDataServiceConfig } from '@/config/env';
import { DataAccessError, requireUuid } from './errors';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createGmailOAuthRepository } from './gmail-oauth-repository';
import { assertPrivacyAuthorized } from './privacy';
import { createPrivacyRequestExecutor } from './privacy-provider';

export async function openGmailOAuthData(client: DataClient) {
  const { user } = await openUserDataAccess(client);
  const { data, error } = await client.auth.getClaims();
  if (
    error ||
    !data ||
    data.claims.sub !== user.id ||
    typeof data.claims.session_id !== 'string'
  )
    throw new DataAccessError('UNAUTHENTICATED');
  const sessionId = data.claims.session_id;
  requireUuid(sessionId);
  const config = getDataServiceConfig();
  const service = createServiceDataClient(config);
  await assertPrivacyAuthorized(service, user.id);
  return Object.freeze({
    user,
    execute: createPrivacyRequestExecutor(service, user.id),
    store: createGmailOAuthRepository(service, user.id, sessionId),
  });
}
