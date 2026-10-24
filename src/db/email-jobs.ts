import type { DataClient } from './models';
import type { Tables } from './database.types';
import { DataAccessError, requireUuid, requireResource } from './errors';
import { createOwnerRepositories } from './repositories';
import {
  canTransitionEmailJob,
  emailJobStatuses,
  EmailJobError,
  jobClassificationSchema,
} from '@/modules/workflow/email-job';
import type { EmailJob, EmailJobStore } from '@/worker/email-jobs';
import type { OwnedWorkItem } from '@/worker/data-access';

async function checked<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T> {
  try {
    const result = await query;
    if (result.error || result.data === null)
      throw new DataAccessError('UNAVAILABLE');
    return result.data;
  } catch {
    throw new DataAccessError('UNAVAILABLE');
  }
}
function decode(row: Tables<'email_jobs'>): EmailJob {
  if (!emailJobStatuses.includes(row.status as never))
    throw new DataAccessError('UNAVAILABLE');
  requireUuid(row.id);
  requireUuid(row.user_id);
  requireUuid(row.gmail_account_id);
  const classification =
    row.classification === null
      ? null
      : jobClassificationSchema.safeParse(row.classification);
  if (classification && !classification.success)
    throw new DataAccessError('UNAVAILABLE');
  return {
    id: row.id,
    userId: row.user_id,
    gmailAccountId: row.gmail_account_id,
    targetMessageId: row.target_message_id,
    threadId: row.thread_id,
    status: row.status as EmailJob['status'],
    leaseId: row.lease_id,
    classification: classification?.success ? classification.data : null,
    draftId: row.draft_id,
  };
}
function parameters(job: EmailJob) {
  requireUuid(job.id);
  requireUuid(job.userId);
  requireUuid(job.gmailAccountId);
  if (!job.leaseId) throw new EmailJobError('LEASE_LOST');
  requireUuid(job.leaseId);
  return {
    p_user_id: job.userId,
    p_account_id: job.gmailAccountId,
    p_job_id: job.id,
    p_lease_id: job.leaseId,
  };
}
export function createEmailJobStore(client: DataClient) {
  return Object.freeze({
    async claim(leaseSeconds: number, includeGeneration: boolean) {
      const rows = await checked(
        client.rpc('claim_email_job', {
          p_lease_seconds: leaseSeconds,
          p_include_generation: includeGeneration,
        }),
      );
      if (rows.length > 1) throw new DataAccessError('UNAVAILABLE');
      if (!rows[0]) return null;
      const job = decode(rows[0]);
      if (!['CLASSIFYING', 'GENERATING'].includes(job.status) || !job.leaseId)
        throw new DataAccessError('UNAVAILABLE');
      return job;
    },
    async renew(job, leaseSeconds) {
      return checked(
        client.rpc('renew_email_job', {
          ...parameters(job),
          p_lease_seconds: leaseSeconds,
        }),
      );
    },
    async advance(job, outcome) {
      if (
        !canTransitionEmailJob(job.status, outcome.status) ||
        (outcome.reasonCode !== undefined &&
          !/^[A-Z][A-Z0-9_]{0,63}$/.test(outcome.reasonCode)) ||
        (outcome.draftId !== undefined &&
          !/^[A-Za-z0-9_-]{1,512}$/.test(outcome.draftId))
      )
        throw new EmailJobError('INVALID_INPUT');
      const parsed =
        outcome.classification === undefined
          ? null
          : jobClassificationSchema.safeParse(outcome.classification);
      if (parsed && !parsed.success) throw new EmailJobError('INVALID_INPUT');
      const rows = await checked(
        client.rpc('advance_email_job', {
          ...parameters(job),
          p_expected_status: job.status,
          p_status: outcome.status,
          p_reason_code: outcome.reasonCode,
          p_draft_id: outcome.draftId,
          ...(parsed?.success ? { p_classification: parsed.data } : {}),
        }),
      );
      if (rows.length !== 1) throw new EmailJobError('LEASE_LOST');
      const updated = decode(rows[0]);
      if (
        updated.id !== job.id ||
        updated.userId !== job.userId ||
        updated.gmailAccountId !== job.gmailAccountId
      )
        throw new DataAccessError('UNAVAILABLE');
      return updated;
    },
    async recover(limit) {
      return checked(client.rpc('recover_email_jobs', { p_limit: limit }));
    },
    async retry(work: OwnedWorkItem, jobId: string) {
      requireUuid(work.userId);
      requireUuid(work.gmailAccountId);
      requireUuid(jobId);
      const owner = createOwnerRepositories(client, work.userId);
      if ((await owner.users.get())?.status !== 'ACTIVE')
        throw new DataAccessError('FORBIDDEN');
      requireResource(await owner.gmailAccounts.findById(work.gmailAccountId));
      return checked(
        client.rpc('retry_email_job', {
          p_user_id: work.userId,
          p_account_id: work.gmailAccountId,
          p_job_id: jobId,
        }),
      );
    },
  } satisfies EmailJobStore & {
    retry(work: OwnedWorkItem, jobId: string): Promise<boolean>;
  });
}
