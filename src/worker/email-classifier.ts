import type { DataClient } from '@/db/models';
import { DataAccessError } from '@/db/errors';
import { createClassifierExclusionRepository } from '@/db/classifier-exclusions';
import {
  createEmailClassifier,
  type ClassifierExclusions,
} from '@/modules/classifier/email-classifier';
import { normalizeClassifierExclusions } from '@/modules/classifier/rules';
import type { ClassifierDependencies } from '@/modules/classifier/contracts';
import { openWorkerDataAccess, type OwnedWorkItem } from './data-access';

export async function createAccountEmailClassifier(
  input: ClassifierDependencies & { client: DataClient; work: OwnedWorkItem },
) {
  const data = await openWorkerDataAccess(input.client, input.work);
  const rules = createClassifierExclusionRepository(
    input.client,
    input.work.userId,
    input.work.gmailAccountId,
  );
  const classifier = createEmailClassifier(input);
  return Object.freeze({
    async classify(
      messageId: string,
      additionalExclusions: ClassifierExclusions = {},
    ) {
      const extra = normalizeClassifierExclusions(additionalExclusions);
      const account = await data.getAccount();
      if (account.status !== 'CONNECTED')
        throw new DataAccessError('FORBIDDEN');
      const stored = await rules.get();
      return classifier.classify({
        messageId,
        mailboxAddress: account.email,
        exclusions: {
          excludedAddresses: [
            ...new Set([
              ...stored.excludedAddresses,
              ...extra.excludedAddresses,
            ]),
          ],
          excludedDomains: [
            ...new Set([...stored.excludedDomains, ...extra.excludedDomains]),
          ],
        },
      });
    },
  });
}
