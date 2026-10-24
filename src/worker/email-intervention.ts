import type { DataClient } from '@/db/models';
import type { GmailClient } from '@/providers/contracts';
import { DataAccessError } from '@/db/errors';
import { createInterventionHistoryRepository } from '@/db/intervention-history';
import { checkEmailIntervention } from '@/modules/gmail/intervention';
import { openWorkerDataAccess } from './data-access';
import type { EmailJob } from './email-jobs';

export async function checkAccountEmailIntervention(input: {
  client: DataClient;
  gmail: Pick<GmailClient, 'get' | 'getThread'>;
  job: EmailJob;
}) {
  const data = await openWorkerDataAccess(input.client, input.job);
  const account = await data.getAccount();
  if (account.status !== 'CONNECTED') throw new DataAccessError('FORBIDDEN');
  const attempts = await createInterventionHistoryRepository(
    input.client,
    input.job.userId,
    input.job.gmailAccountId,
  ).forThread(input.job.threadId);
  return checkEmailIntervention({
    gmail: input.gmail,
    accountId: input.job.gmailAccountId,
    mailboxAddress: account.email,
    threadId: input.job.threadId,
    targetMessageId: input.job.targetMessageId,
    attempts,
  });
}
