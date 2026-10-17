import { DataAccessError } from './errors';
import type { DataClient } from './models';
import { createOwnerRepositories } from './repositories';

export async function openUserDataAccess(client: DataClient) {
  try {
    const { data, error } = await client.auth.getUser();
    if (error) {
      throw new DataAccessError(
        !error.status || error.status >= 500 || error.status === 429
          ? 'UNAVAILABLE'
          : 'UNAUTHENTICATED',
      );
    }
    const user = data.user;
    if (!user || user.is_anonymous || !user.email || !user.email_confirmed_at) {
      throw new DataAccessError('UNAUTHENTICATED');
    }
    const repositories = createOwnerRepositories(client, user.id);
    const profile = await repositories.users.get();
    if (!profile || profile.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');

    return Object.freeze({
      user: Object.freeze({ id: user.id, email: user.email }),
      settings: repositories.settings,
      gmailAccounts: repositories.gmailAccounts,
      processingRuns: Object.freeze({
        list: repositories.processingRuns.list,
        findById: (id: string) => repositories.processingRuns.findById(id),
      }),
    });
  } catch (error) {
    if (error instanceof DataAccessError) throw error;
    throw new DataAccessError('UNAVAILABLE');
  }
}
