import 'server-only';
import type { DataClient } from './models';
import { DataAccessError } from './errors';
import { createOwnerRepositories } from './repositories';
import { createServiceDataClient } from './service-client';
import { getDataServiceConfig } from '@/config/env';
import { createAccountLifecycleRepository } from './account-deletion';
export async function openUserAccountLifecycle(client: DataClient) {
  const { data, error } = await client.auth.getUser();
  const user = data.user;
  if (
    error ||
    !user ||
    user.is_anonymous ||
    !user.email ||
    !user.email_confirmed_at
  )
    throw new DataAccessError('UNAUTHENTICATED');
  const profile = await createOwnerRepositories(client, user.id).users.get();
  if (!profile || !['ACTIVE', 'DELETION_PENDING'].includes(profile.status))
    throw new DataAccessError('FORBIDDEN');
  const service = createServiceDataClient(getDataServiceConfig()),
    repository = createAccountLifecycleRepository(service, user.id);
  return Object.freeze({
    ...repository,
    email: user.email,
    async revokeSessions() {
      const session = await client.auth.getSession();
      if (session.data.session)
        await service.auth.admin.signOut(
          session.data.session.access_token,
          'global',
        );
      await client.auth.signOut({ scope: 'local' });
    },
  });
}
