import { randomUUID } from 'node:crypto';
import { createResponseValidationRepository } from '@/db/response-validation';
import { DraftWriteError } from '@/modules/gmail/draft-contracts';
import { createResponsePolicyRepository } from '@/db/response-policy';
import { createResponsePolicyEngine } from '@/modules/policy/response-policy';
import {
  mergePolicyEvaluations,
  responsePolicyVersion,
  type ResponsePolicyEvaluation,
} from '@/modules/policy/settings';
import { DraftPreconditionError } from '@/modules/gmail/draft-contracts';
import type { DataClient } from '@/db/models';
import type { GmailClient } from '@/providers/contracts';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { createDraftWriter } from '@/modules/gmail/draft-writer';
import { EmailJobError } from '@/modules/workflow/email-job';
import { openWorkerDataAccess } from './data-access';
import type { EmailJob, GenerationOutcome } from './email-jobs';

export function createEmailJobDraftWriter(input: {
  client: DataClient;
  gmail: Pick<GmailClient, 'getThread' | 'getMessage' | 'createDraft'>;
  job: EmailJob;
  assertLease(): Promise<void>;
  signal?: AbortSignal;
}) {
  const { job } = input;
  if (job.status !== 'GENERATING' || !job.leaseId)
    throw new EmailJobError('INVALID_INPUT');
  const leaseId = job.leaseId;
  const policyRepository = createResponsePolicyRepository(
    input.client,
    job.userId,
  );
  return Object.freeze({
    async create(
      options: Parameters<ReturnType<typeof createDraftWriter>['create']>[0],
    ): Promise<GenerationOutcome> {
      if (
        options.context.accountId !== job.gmailAccountId ||
        options.context.threadId !== job.threadId ||
        options.context.targetMessageId !== job.targetMessageId
      )
        throw new EmailJobError('INVALID_INPUT');
      const account = await (
        await openWorkerDataAccess(input.client, job)
      ).getAccount();
      if (
        options.selection.mailboxAddress.toLowerCase() !==
        account.email.toLowerCase()
      )
        throw new EmailJobError('INVALID_INPUT');
      const snapshot = await policyRepository.get();
      const access = policyRepository.forAccount(job.gmailAccountId);
      const engine = createResponsePolicyEngine(snapshot.settings);
      const before = engine.preflight(
        {
          conversation: options.context.modelInput,
          policyContext: {
            sender: options.context.replyTarget.to.address,
            category: job.classification?.intent,
            riskFlags: [...(job.classification?.riskFlags ?? [])],
          },
        },
        { checkSources: false },
      );
      const extra: ResponsePolicyEvaluation[] = [];
      const configured =
        snapshot.settings.blockedSenders.length ||
        snapshot.settings.blockedDomains.length ||
        snapshot.settings.blockedCategories.length ||
        snapshot.settings.blockedTopics.length ||
        snapshot.settings.sourceRequirements.length;
      if (
        options.response.policyRevision &&
        options.response.policyRevision !== snapshot.revision
      )
        extra.push({
          version: responsePolicyVersion,
          phase: 'PREFLIGHT',
          action: 'REVIEW_REQUIRED',
          reasons: ['POLICY_CHANGED'],
        });
      if (
        configured &&
        (!options.response.policyRevision ||
          !options.response.policyEvaluations?.length)
      )
        extra.push({
          version: responsePolicyVersion,
          phase: 'PREFLIGHT',
          action: 'REVIEW_REQUIRED',
          reasons: ['POLICY_CONTEXT_REQUIRED'],
        });
      const decision = mergePolicyEvaluations('PREFLIGHT', [
        before,
        ...extra,
        ...(options.response.policyEvaluations ?? []).filter(
          (e) => e.action !== 'ALLOW_DRAFT',
        ),
      ]);
      if (decision.action !== 'ALLOW_DRAFT') {
        await access.record(
          options.context,
          decision,
          randomUUID(),
          snapshot.revision,
        );
        return { status: 'REVIEW_REQUIRED', reasonCode: 'POLICY_RESTRICTED' };
      }
      let factualRejected = false;
      const writer = createDraftWriter({
        recordFactualValidation: async (validation) => {
          factualRejected = true;
          await createResponseValidationRepository(
            input.client,
            job.userId,
            job.gmailAccountId,
          ).record(options.context, validation, randomUUID());
        },
        gmail: input.gmail,
        store: createDraftGenerationRepository(
          input.client,
          job.userId,
          job.gmailAccountId,
          {
            id: job.id,
            leaseId,
            threadId: job.threadId,
            targetMessageId: job.targetMessageId,
          },
        ),
        async assertCanWrite() {
          await input.assertLease();
          const latest = await policyRepository.get();
          if (latest.revision !== snapshot.revision) {
            await access.record(
              options.context,
              {
                version: responsePolicyVersion,
                phase: 'POSTFLIGHT',
                action: 'REVIEW_REQUIRED',
                reasons: ['POLICY_CHANGED'],
              },
              randomUUID(),
              latest.revision,
            );
            throw new DraftPreconditionError('PREWRITE_FAILED');
          }
        },
        signal: input.signal,
      });

      let draft;
      try {
        draft = await writer.create({
          ...options,
          response: { ...options.response, policyRevision: snapshot.revision },
        });
      } catch (error) {
        if (
          factualRejected &&
          error instanceof DraftWriteError &&
          error.code === 'RESPONSE_NOT_READY'
        )
          return {
            status: 'REVIEW_REQUIRED',
            reasonCode: 'FACTUAL_VALIDATION_FAILED',
          };
        throw error;
      }
      if (
        ['CREATED', 'CREATED_UNVERIFIED', 'ALREADY_CREATED'].includes(
          draft.status,
        ) &&
        draft.draftId
      )
        return { status: 'DRAFT_CREATED', draftId: draft.draftId };
      // Cancelled preflight is terminal for this generation, not an ambiguous
      // Gmail write. Preserve its cause and never enqueue another POST.
      return {
        status: 'REVIEW_REQUIRED',
        reasonCode: draft.reason ?? 'DRAFT_RECONCILIATION_REQUIRED',
      };
    },
  });
}
