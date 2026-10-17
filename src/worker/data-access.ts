import { DataAccessError, requireResource, requireUuid } from '@/db/errors';
import type { DataClient, RunOutcome, RunTrigger } from '@/db/models';
import { createOwnerRepositories } from '@/db/repositories';

export type OwnedWorkItem = Readonly<{
  userId: string;
  gmailAccountId: string;
}>;

export async function openWorkerDataAccess(
  client: DataClient,
  work: OwnedWorkItem,
) {
  const ownerId = work?.userId;
  const accountId = work?.gmailAccountId;
  requireUuid(ownerId);
  requireUuid(accountId);
  const repositories = createOwnerRepositories(client, ownerId);

  const authorize = async () => {
    const profile = await repositories.users.get();
    if (!profile || profile.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
    return requireResource(
      await repositories.gmailAccounts.findById(accountId),
    );
  };
  await authorize();

  return Object.freeze({
    async getAccount() {
      return authorize();
    },
    async getSettings() {
      await authorize();
      return repositories.settings.get();
    },
    processingRuns: Object.freeze({
      async findById(id: string) {
        await authorize();
        return repositories.processingRuns.findById(id, accountId);
      },
      async start(trigger: RunTrigger) {
        await authorize();
        return repositories.processingRuns.start(accountId, trigger);
      },
      async finish(id: string, outcome: RunOutcome) {
        await authorize();
        return repositories.processingRuns.finish(id, accountId, outcome);
      },
    }),
  });
}
