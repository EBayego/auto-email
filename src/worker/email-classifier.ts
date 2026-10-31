import type { DataClient } from '@/db/models';
import { DataAccessError } from '@/db/errors';
import { createAutomationSettingsRepository } from '@/db/automation-settings';
import {
  createEmailClassifier,
  type ClassifierExclusions,
} from '@/modules/classifier/email-classifier';
import { normalizeClassifierExclusions } from '@/modules/classifier/rules';
import { classificationResult } from '@/modules/classifier/rules';
import type { ClassifierDependencies } from '@/modules/classifier/contracts';
import { openWorkerDataAccess, type OwnedWorkItem } from './data-access';

export async function createAccountEmailClassifier(
  input: ClassifierDependencies & { client: DataClient; work: OwnedWorkItem },
) {
  const data = await openWorkerDataAccess(input.client, input.work);
  const configuration = createAutomationSettingsRepository(
    input.client,
    input.work.userId,
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
      const { settings: stored } = await configuration.get();
      const result = await classifier.classify({
        messageId,
        mailboxAddress: account.email,
        processingScope: stored.processingScope,
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
      return stored.policy.blockedCategories.includes(result.intent) &&
        result.decision === 'REPLY_REQUIRED'
        ? classificationResult('NO_REPLY', ['CATEGORY_EXCLUDED'], result)
        : result;
    },
  });
}
