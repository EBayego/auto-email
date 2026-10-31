import type { DataClient } from '@/db/models';
import { createAutomationSettingsRepository } from '@/db/automation-settings';
import { DataAccessError } from '@/db/errors';
import type { GmailClient } from '@/providers/contracts';
import { matchesProcessingScope } from '@/modules/workflow/processing-selection';
import {
  classifierMetadataHeaders,
  inspectClassifierMetadata,
  normalizeClassifierExclusions,
} from '@/modules/classifier/rules';
import type { JobClassification } from '@/modules/workflow/email-job';
import { openWorkerDataAccess, type OwnedWorkItem } from './data-access';

export async function inspectAutomationSelection(input: {
  client: DataClient;
  work: OwnedWorkItem;
  gmail: Pick<GmailClient, 'getMessage'>;
  messageId: string;
  classification?: JobClassification | null;
}) {
  const account = await (
    await openWorkerDataAccess(input.client, input.work)
  ).getAccount();
  if (account.status !== 'CONNECTED') throw new DataAccessError('FORBIDDEN');
  const snapshot = await createAutomationSettingsRepository(
    input.client,
    input.work.userId,
  ).get();
  const settings = snapshot.settings;
  if (
    input.classification &&
    settings.policy.blockedCategories.includes(input.classification.intent)
  )
    return { revision: snapshot.revision, reason: 'CATEGORY_EXCLUDED' };
  if (
    settings.processingScope === 'ALL_INCOMING' &&
    !settings.excludedAddresses.length &&
    !settings.excludedDomains.length
  )
    return { revision: snapshot.revision, reason: null };
  const message = await input.gmail.getMessage(input.messageId, {
    format: 'metadata',
    metadataHeaders: classifierMetadataHeaders,
  });
  if (message.id !== input.messageId) throw new DataAccessError('UNAVAILABLE');
  const result = inspectClassifierMetadata(
    message,
    account.email,
    normalizeClassifierExclusions({
      excludedAddresses: settings.excludedAddresses,
      excludedDomains: settings.excludedDomains,
    }),
  ).result;
  return {
    revision: snapshot.revision,
    reason:
      result?.reasons[0] ??
      (!matchesProcessingScope(message, settings.processingScope)
        ? 'OUTSIDE_SELECTION'
        : null),
  };
}
