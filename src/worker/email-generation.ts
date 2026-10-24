import type { ReplyOrchestratorDependencies } from '@/modules/response/orchestrator';
import { createReplyOrchestrator } from '@/modules/response/orchestrator';
import type { ManualSelectionInput } from '@/modules/gmail/manual-selection';
import type { DraftStore } from '@/modules/gmail/draft-contracts';
import type { createEmailJobDraftWriter } from './email-drafts';
import type { EmailJob, GenerationOutcome } from './email-jobs';

export async function generateEmailJobDraft(input: {
  job: EmailJob;
  selection: ManualSelectionInput;
  store: DraftStore;
  model: string;
  orchestration: ReplyOrchestratorDependencies;
  writer: Pick<ReturnType<typeof createEmailJobDraftWriter>, 'create'>;
  assertLease(): Promise<void>;
  signal?: AbortSignal;
}): Promise<GenerationOutcome> {
  const { job } = input;
  if (
    job.status !== 'GENERATING' ||
    !job.leaseId ||
    job.classification?.decision !== 'REPLY_REQUIRED'
  )
    throw new Error('INVALID_GENERATION_JOB');
  await input.assertLease();
  const known = await input.store.find(job.targetMessageId);
  const existing = (record: NonNullable<typeof known>): GenerationOutcome =>
    record.status === 'CREATED' && record.draftId
      ? { status: 'DRAFT_CREATED', draftId: record.draftId }
      : {
          status: 'REVIEW_REQUIRED',
          reasonCode: 'DRAFT_RECONCILIATION_REQUIRED',
        };
  if (known) return existing(known);
  if (input.signal?.aborted)
    return { status: 'REVIEW_REQUIRED', reasonCode: 'WORKER_STOPPED' };
  if (!input.selection.style && !input.selection.resolveStyle)
    return { status: 'REVIEW_REQUIRED', reasonCode: 'STYLE_PROFILE_REQUIRED' };
  let outcome: GenerationOutcome | undefined;
  const result = await createReplyOrchestrator(input.orchestration).generate({
    selection: { ...input.selection, targetMessageId: job.targetMessageId },
    shouldGenerate: async () => {
      await input.assertLease();
      if (input.signal?.aborted) {
        outcome = { status: 'REVIEW_REQUIRED', reasonCode: 'WORKER_STOPPED' };
        return false;
      }
      const row = await input.store.find(job.targetMessageId);
      if (row) {
        outcome = existing(row);
        return false;
      }
      return true;
    },
    consume: async (response, context) => {
      if (response.status !== 'READY') {
        outcome = {
          status: 'REVIEW_REQUIRED',
          reasonCode:
            response.warnings.find((w) => w !== 'HUMAN_REVIEW_REQUIRED') ??
            'RESPONSE_REQUIRES_REVIEW',
        };
        return;
      }
      await input.assertLease();
      if (input.signal?.aborted) {
        outcome = { status: 'REVIEW_REQUIRED', reasonCode: 'WORKER_STOPPED' };
        return;
      }
      outcome = await input.writer.create({
        selection: input.selection,
        context,
        response,
        model: input.model,
      });
    },
  });
  if (outcome) return outcome;
  if (result.selection.status === 'EXISTING_DRAFT')
    return { status: 'SKIPPED', reasonCode: 'EXISTING_MANUAL_DRAFT' };
  if (result.selection.status === 'ALREADY_ANSWERED')
    return { status: 'SKIPPED', reasonCode: 'ALREADY_ANSWERED' };
  if (result.selection.status === 'SUPERSEDED')
    return { status: 'SKIPPED', reasonCode: 'TARGET_SUPERSEDED' };
  return {
    status: 'REVIEW_REQUIRED',
    reasonCode: result.selection.warnings[0] ?? 'THREAD_UNVERIFIABLE',
  };
}
