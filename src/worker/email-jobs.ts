import { DataAccessError } from '@/db/errors';
import { ProviderError } from '@/providers/errors';
import { GmailCredentialError } from '@/modules/gmail/credentials';
import {
  EmailJobError,
  jobClassification,
  type EmailJobStatus,
  type JobClassification,
} from '@/modules/workflow/email-job';
import type { EmailClassification } from '@/modules/classifier/contracts';
import type { OwnedWorkItem } from './data-access';
import type { InterventionDecision } from '@/modules/gmail/intervention';

export type EmailJob = OwnedWorkItem &
  Readonly<{
    id: string;
    targetMessageId: string;
    threadId: string;
    status: EmailJobStatus;
    leaseId: string | null;
    classification: JobClassification | null;
    draftId: string | null;
  }>;
export type JobAdvance = Readonly<{
  status: EmailJobStatus;
  reasonCode?: string;
  classification?: JobClassification;
  draftId?: string;
}>;
export interface EmailJobStore {
  claim(
    leaseSeconds: number,
    includeGeneration: boolean,
  ): Promise<EmailJob | null>;
  renew(job: EmailJob, leaseSeconds: number): Promise<boolean>;
  advance(job: EmailJob, outcome: JobAdvance): Promise<EmailJob>;
  recover(limit: number): Promise<number>;
}
export type EmailJobConfig = Readonly<{
  leaseSeconds: number;
  maxJobsPerCycle: number;
}>;
export type JobEvent = Readonly<{
  type:
    | 'JOB_PROCESSED'
    | 'JOB_PROCESSING_FAILED'
    | 'JOB_CYCLE_COMPLETED'
    | 'JOB_CYCLE_FAILED'
    | 'DRAFT_RECONCILED'
    | 'DRAFT_RECONCILIATION_FAILED';
  attemptId?: string;
  jobId?: string;
  accountId?: string;
  status?: EmailJobStatus;
  reasonCode?: string;
  claimed?: number;
  classified?: number;
  skipped?: number;
  awaitingGeneration?: number;
  reviewRequired?: number;
  draftsCreated?: number;
  failed?: number;
  recovered?: number;
}>;
export type GenerationOutcome =
  | { status: 'DRAFT_CREATED'; draftId: string }
  | { status: 'REVIEW_REQUIRED' | 'FAILED' | 'SKIPPED'; reasonCode: string };
export type EmailJobDependencies = {
  store: EmailJobStore;
  inspect(job: EmailJob): Promise<InterventionDecision>;
  classifierFor(
    work: OwnedWorkItem,
  ): Promise<{ classify(messageId: string): Promise<EmailClassification> }>;
  generate?: (
    job: EmailJob,
    control: { assertLease(): Promise<void>; signal?: AbortSignal },
  ) => Promise<GenerationOutcome>;
  report(event: JobEvent): void;
  reconcileDrafts?: (limit: number, signal?: AbortSignal) => Promise<void>;
};

export function emailJobErrorCode(error: unknown): string {
  if (error instanceof ProviderError && error.retryStop)
    return `JOB_${error.provider.toUpperCase()}_${error.code}_${error.retryStop}`;
  if (
    error instanceof EmailJobError ||
    error instanceof DataAccessError ||
    error instanceof GmailCredentialError ||
    error instanceof ProviderError
  )
    return `JOB_${error.code}`;
  return 'JOB_UNAVAILABLE';
}

async function processJob(
  deps: EmailJobDependencies,
  config: EmailJobConfig,
  job: EmailJob,
  signal?: AbortSignal,
): Promise<{
  status: EmailJobStatus | 'PROCESSING_FAILED';
  classified: boolean;
}> {
  let lost = false;
  let classified = false;
  let refreshing: Promise<void> | undefined;
  const renew = async () => {
    try {
      if (!(await deps.store.renew(job, config.leaseSeconds))) lost = true;
    } catch {
      lost = true;
    }
  };
  const assertLease = async () => {
    await refreshing;
    if (!lost) await renew();
    if (lost) throw new EmailJobError('LEASE_LOST');
  };
  const timer = setInterval(
    () => {
      if (!refreshing)
        refreshing = renew().finally(() => {
          refreshing = undefined;
        });
    },
    Math.max(1000, Math.floor((config.leaseSeconds * 1000) / 3)),
  );
  try {
    await assertLease();
    let outcome: JobAdvance;
    const inspection = signal?.aborted
      ? { status: 'CONTINUE' as const }
      : await deps.inspect(job);
    await assertLease();
    if (inspection.status !== 'CONTINUE') outcome = inspection;
    else if (job.status === 'CLASSIFYING') {
      if (signal?.aborted)
        outcome = { status: 'PENDING', reasonCode: 'WORKER_STOPPED' };
      else {
        const classifier = await deps.classifierFor({
          userId: job.userId,
          gmailAccountId: job.gmailAccountId,
        });
        const result = await classifier.classify(job.targetMessageId);
        const operational = result.reasons.find((reason) =>
          ['MODEL_UNAVAILABLE', 'INVALID_MODEL_RESPONSE'].includes(reason),
        );
        classified = !operational;
        outcome = operational
          ? { status: 'FAILED', reasonCode: operational }
          : {
              status:
                result.decision === 'NO_REPLY'
                  ? 'SKIPPED'
                  : result.decision === 'UNCERTAIN'
                    ? 'REVIEW_REQUIRED'
                    : 'GENERATING',
              reasonCode: result.reasons[0],
              classification: jobClassification(result),
            };
      }
    } else if (job.status === 'GENERATING' && deps.generate) {
      outcome = signal?.aborted
        ? { status: 'REVIEW_REQUIRED', reasonCode: 'WORKER_STOPPED' }
        : await deps.generate(job, { assertLease, signal });
    } else throw new EmailJobError('INVALID_INPUT');
    await assertLease();
    const updated = await deps.store.advance(job, outcome);
    deps.report({
      type: 'JOB_PROCESSED',
      jobId: job.id,
      accountId: job.gmailAccountId,
      status: updated.status,
      reasonCode: outcome.reasonCode,
    });
    return { status: updated.status, classified };
  } catch (error) {
    const interrupted = job.status === 'CLASSIFYING' && signal?.aborted;
    const reasonCode = interrupted
      ? 'WORKER_STOPPED'
      : job.status === 'GENERATING'
        ? 'GENERATION_OUTCOME_UNKNOWN'
        : emailJobErrorCode(error);
    if (!lost) {
      try {
        const updated = await deps.store.advance(job, {
          status: interrupted
            ? 'PENDING'
            : job.status === 'GENERATING'
              ? 'REVIEW_REQUIRED'
              : 'FAILED',
          reasonCode,
        });
        deps.report({
          type: 'JOB_PROCESSED',
          jobId: job.id,
          accountId: job.gmailAccountId,
          status: updated.status,
          reasonCode,
        });
        return { status: updated.status, classified: false };
      } catch {
        /* The lease or storage can be unavailable. Recovery handles it on the next cycle. */
      }
    }
    deps.report({
      type: 'JOB_PROCESSING_FAILED',
      jobId: job.id,
      accountId: job.gmailAccountId,
      reasonCode,
    });
    return { status: 'PROCESSING_FAILED', classified: false };
  } finally {
    clearInterval(timer);
    await refreshing;
  }
}

export async function runEmailJobCycle(
  deps: EmailJobDependencies,
  config: EmailJobConfig,
  signal?: AbortSignal,
) {
  const result = {
    claimed: 0,
    classified: 0,
    skipped: 0,
    awaitingGeneration: 0,
    reviewRequired: 0,
    draftsCreated: 0,
    failed: 0,
    recovered: 0,
  };
  if (signal?.aborted) return result;
  result.recovered = await deps.store.recover(config.maxJobsPerCycle);
  await deps.reconcileDrafts?.(config.maxJobsPerCycle, signal);
  for (let i = 0; i < config.maxJobsPerCycle && !signal?.aborted; i++) {
    const job = await deps.store.claim(config.leaseSeconds, !!deps.generate);
    if (!job) break;
    result.claimed++;
    const { status, classified } = await processJob(deps, config, job, signal);
    if (classified) result.classified++;
    if (status === 'SKIPPED') result.skipped++;
    else if (status === 'GENERATING') result.awaitingGeneration++;
    else if (status === 'REVIEW_REQUIRED') result.reviewRequired++;
    else if (status === 'DRAFT_CREATED') result.draftsCreated++;
    else if (status === 'FAILED' || status === 'PROCESSING_FAILED')
      result.failed++;
  }
  deps.report({ type: 'JOB_CYCLE_COMPLETED', ...result });
  return result;
}
