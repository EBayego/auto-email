import type { DataClient } from './models';
import { DataAccessError, requireResource, requireUuid } from './errors';
import { createOwnerRepositories } from './repositories';
import { normalizeClassifierExclusions } from '@/modules/classifier/rules';
import type { ClassifierExclusions } from '@/modules/classifier/contracts';

export function createClassifierExclusionRepository(
  client: DataClient,
  userId: string,
  accountId: string,
) {
  requireUuid(userId);
  requireUuid(accountId);
  const authorize = async () => {
    const owner = createOwnerRepositories(client, userId);
    if ((await owner.users.get())?.status !== 'ACTIVE')
      throw new DataAccessError('FORBIDDEN');
    requireResource(await owner.gmailAccounts.findById(accountId));
  };
  const decode = (
    row: {
      user_id: string;
      classifier_excluded_addresses: string[];
      classifier_excluded_domains: string[];
    } | null,
  ) => {
    if (!row || row.user_id !== userId)
      throw new DataAccessError('UNAVAILABLE');
    try {
      return normalizeClassifierExclusions({
        excludedAddresses: row.classifier_excluded_addresses,
        excludedDomains: row.classifier_excluded_domains,
      });
    } catch {
      throw new DataAccessError('UNAVAILABLE');
    }
  };
  const columns =
    'user_id, classifier_excluded_addresses, classifier_excluded_domains';
  return Object.freeze({
    async get() {
      await authorize();
      const { data, error } = await client
        .from('user_settings')
        .select(columns)
        .eq('user_id', userId)
        .single();
      if (error) throw new DataAccessError('UNAVAILABLE');
      return decode(data);
    },
    async set(input: ClassifierExclusions) {
      const exclusions = normalizeClassifierExclusions(input);
      await authorize();
      const { data, error } = await client
        .from('user_settings')
        .update({
          classifier_excluded_addresses: [...exclusions.excludedAddresses],
          classifier_excluded_domains: [...exclusions.excludedDomains],
        })
        .eq('user_id', userId)
        .select(columns)
        .single();
      if (error) throw new DataAccessError('UNAVAILABLE');
      return decode(data);
    },
  });
}
