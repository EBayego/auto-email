import { randomUUID } from 'node:crypto';
import { replyRecipientAddresses } from '@/modules/gmail/reply-recipients';
import {
  applyFactualValidation,
  factualAudit,
  type FactualValidationAccess,
} from './factual-validation';
import { createResponsePolicyEngine } from '@/modules/policy/response-policy';
import { applyResponsePolicy } from '@/modules/policy/policy-result';
import {
  responsePolicyVersion,
  mergePolicyEvaluations,
} from '@/modules/policy/settings';
import type { ResponsePolicyAccess } from '@/modules/policy/access';
import type { GmailClient } from '@/providers/contracts';
import {
  selectPendingEmail,
  type ManualSelectionInput,
  type ManualSelectionReport,
  type PreparedReplyContext,
} from '@/modules/gmail/manual-selection';
import {
  ResponseGenerationError,
  type ResponseGenerationResult,
  type GenerateReplyInput,
  type GenerateReplyResult,
  type ResponseGenerator,
} from './contracts';
import { responsePromptVersion } from './prompts';
import type {
  StyleExample,
  StyleExampleRetriever,
} from '@/modules/identity/style-example-retriever';
import type { KnowledgeRetrievalResult } from '@/modules/knowledge/retriever';

export type ReplyGenerationReport = {
  selection: ManualSelectionReport;
  generation: {
    status: ResponseGenerationResult['status'];
    language: string;
    warnings: ResponseGenerationResult['warnings'];
    missingInformationCount: number;
    evidenceCount: number;
    bodyCharacters: number;
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    examplesUsed: number;
    promptVersion: string;
    styleExamplesUnavailable: boolean;
    knowledgeFragmentsUsed: number;
    knowledgeTokenUpperBound: number;
    needsHumanInput: boolean;
  } | null;
};
export type ReplyOrchestrationInput = {
  selection: ManualSelectionInput;
  styleExamplesLimit?: number;
  userInstructions?: readonly string[];
  now?: Date;
  shouldGenerate?: (context: PreparedReplyContext) => Promise<boolean>;
  consume?: (
    response: GenerateReplyResult,
    context: PreparedReplyContext,
  ) => Promise<void>;
};
export type ReplyOrchestrationResult = ReplyGenerationReport & {
  reply: GenerateReplyResult | null;
};
export type ReplyOrchestratorDependencies = {
  factualValidation?: FactualValidationAccess;
  policy?: ResponsePolicyAccess;
  gmail: Pick<GmailClient, 'getThread'>;
  generator: ResponseGenerator;
  styleExamples: StyleExampleRetriever;
  retrieveKnowledge?: (
    context: PreparedReplyContext,
  ) => Promise<KnowledgeRetrievalResult>;
};
export interface ReplyOrchestrator {
  generate(input: ReplyOrchestrationInput): Promise<ReplyOrchestrationResult>;
}

export function createReplyOrchestrator(
  deps: ReplyOrchestratorDependencies,
): ReplyOrchestrator {
  return Object.freeze({
    async generate(
      input: ReplyOrchestrationInput,
    ): Promise<ReplyOrchestrationResult> {
      if (!input.selection.style && !input.selection.resolveStyle)
        throw new ResponseGenerationError('STYLE_PROFILE_REQUIRED');
      const limit = input.styleExamplesLimit ?? 3;
      if (!Number.isInteger(limit) || limit < 0 || limit > 3)
        throw new ResponseGenerationError('INVALID_INPUT');
      let generation: ReplyGenerationReport['generation'] = null;
      let reply: GenerateReplyResult | null = null;
      const selection = await selectPendingEmail(
        deps.gmail,
        input.selection,
        async (context) => {
          if (input.shouldGenerate && !(await input.shouldGenerate(context)))
            return;
          let examples: StyleExample[] = [];
          let knowledge: KnowledgeRetrievalResult | undefined;
          try {
            const snapshot = await deps.policy?.load(context);
            const engine = createResponsePolicyEngine(snapshot?.settings);
            const evaluationId = randomUUID();
            const baseInput: GenerateReplyInput = {
              recipient: context.replyTarget.to.address,
              recipients: replyRecipientAddresses(context.replyTarget),
              messageAudiences: context.messageAudiences,
              conversation: context.modelInput,
              responsePolicy: snapshot?.settings,
              policyContext: { sender: context.replyTarget.to.address },
            };
            let early = engine.preflight(baseInput, {
              checkSources: false,
              checkCategories: false,
            });
            if (
              early.action === 'ALLOW_DRAFT' &&
              snapshot?.settings.blockedCategories.length
            ) {
              const classified = await deps.policy?.classify?.(context);
              baseInput.policyContext = {
                ...baseInput.policyContext,
                category: classified?.intent,
                riskFlags: classified ? [...classified.riskFlags] : [],
              };
              early = engine.preflight(baseInput, { checkSources: false });
            }
            let response: GenerateReplyResult;
            if (early.action !== 'ALLOW_DRAFT') {
              response = applyResponsePolicy(baseInput, [early]);
              if (snapshot)
                await deps.policy!.record(
                  context,
                  early,
                  evaluationId,
                  snapshot.revision,
                );
            } else {
              examples =
                limit && context.modelInput.style
                  ? await deps.styleExamples.retrieve({
                      accountId: context.accountId,
                      recipient: context.replyTarget.to.address,
                      threadId: context.threadId,
                      subject: context.modelInput.subject,
                      text: context.modelInput.messages.find(
                        (message) => message.isTarget,
                      )!.text,
                      before: context.styleExampleBefore
                        ? new Date(context.styleExampleBefore)
                        : input.now,
                      profile: context.modelInput.style,
                      preferredMessageIds: context.styleExampleMessageIds,
                      language: context.stylePreferences?.preferences.find(
                        (p) => p.key === 'language' && p.value !== 'recipient',
                      )?.value,
                      limit,
                      now: input.now,
                    })
                  : [];
              knowledge = context.modelInput.style
                ? await deps.retrieveKnowledge?.(context)
                : undefined;

              const generationInput: GenerateReplyInput = {
                ...baseInput,
                styleExamples: examples,
                userInstructions: input.userInstructions,
                stylePreferences: context.stylePreferences?.preferences,
                knowledge: knowledge?.matches,
                knowledgePolicy: knowledge?.policy,
                allowPartialDrafts: knowledge?.allowPartialDrafts ?? false,
                allowEmailHistory: knowledge?.plan.allowEmailHistory ?? false,
                policyContext: {
                  ...baseInput.policyContext,
                  category:
                    baseInput.policyContext?.category ??
                    knowledge?.classification?.intent,
                  additionalCategories: knowledge?.classification
                    ? [knowledge.classification.intent]
                    : [],
                  riskFlags: [
                    ...new Set([
                      ...(baseInput.policyContext?.riskFlags ?? []),
                      ...(knowledge?.classification?.riskFlags ?? []),
                    ]),
                  ],
                },
              };
              const before = engine.preflight(generationInput);
              if (snapshot)
                await deps.policy!.record(
                  context,
                  before,
                  evaluationId,
                  snapshot.revision,
                );
              if (before.action !== 'ALLOW_DRAFT')
                response = applyResponsePolicy(generationInput, [before]);
              else {
                response = await deps.generator.generate(generationInput);
                const rawOutputCheck = engine.postflight(
                  generationInput,
                  response,
                );
                response = applyFactualValidation(generationInput, response);
                if (response.factualValidation)
                  await deps.factualValidation?.record(
                    context,
                    factualAudit(response.factualValidation),
                    evaluationId,
                  );
                const latest = await deps.policy?.load(context);
                const latestCheck =
                  snapshot && latest?.revision !== snapshot.revision
                    ? {
                        version: responsePolicyVersion,
                        phase: 'POSTFLIGHT' as const,
                        action: 'REVIEW_REQUIRED' as const,
                        reasons: ['POLICY_CHANGED' as const],
                      }
                    : createResponsePolicyEngine(
                        latest?.settings ?? snapshot?.settings,
                      ).postflight(generationInput, response);
                const after = mergePolicyEvaluations('POSTFLIGHT', [
                  rawOutputCheck,
                  ...(response.policyEvaluations ?? []).filter(
                    (e) => e.action !== 'ALLOW_DRAFT',
                  ),
                  latestCheck,
                ]);
                response = applyResponsePolicy(
                  generationInput,
                  [before, after],
                  response,
                );
                if (latest)
                  await deps.policy!.record(
                    context,
                    after,
                    evaluationId,
                    latest.revision,
                  );
              }
            }
            response.policyRevision = snapshot?.revision;
            // Permission/configuration revisions come from the resolver, never
            // from the model or source content, and stay outside both prompts.
            response.knowledgeRevision = knowledge?.plan.revision;
            reply = response;
            generation = {
              status: response.status,
              language: response.language,
              warnings: response.warnings,
              missingInformationCount: response.missingInformation.length,
              evidenceCount: response.evidence.length,
              bodyCharacters: response.bodyText?.length ?? 0,
              inputTokens: response.inputTokens,
              outputTokens: response.outputTokens,
              modelCalls: response.modelCalls,
              examplesUsed: response.examplesUsed,
              promptVersion: responsePromptVersion,
              styleExamplesUnavailable: limit > 0 && examples.length === 0,
              knowledgeFragmentsUsed: response.sourcesUsed.filter(
                (source) => source.kind === 'KNOWLEDGE_FRAGMENT',
              ).length,
              knowledgeTokenUpperBound: knowledge?.tokenUpperBound ?? 0,
              needsHumanInput: response.needsHumanInput ?? false,
            };
            if (input.consume) await input.consume(response, context);
          } finally {
            examples.length = 0;
            if (knowledge) knowledge.matches.length = 0;
            if (knowledge) knowledge.review.conflicts.length = 0;
          }
        },
      );
      return { selection, generation, reply };
    },
  });
}
