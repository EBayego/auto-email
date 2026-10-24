import { z } from 'zod';
import { audienceMatchesAll } from '@/modules/knowledge/audience';
import { replyRecipientAddresses } from '@/modules/gmail/reply-recipients';
import {
  classificationIntents,
  classificationRisks,
} from '@/modules/classifier/contracts';
import type { PreparedReplyContext } from '@/modules/gmail/manual-selection';
import {
  KnowledgeRetrievalError,
  knowledgeContextSchema,
  knowledgeTokenUpperBound,
  retrievalLimits,
  type KnowledgeRetriever,
  type KnowledgeRetrievalResult,
} from '@/modules/knowledge/retriever';
import {
  routeSources,
  sameSourcePlan,
} from '@/modules/source-router/route-sources';
import {
  SourceConfigurationError,
  type SourceConfiguration,
} from '@/modules/source-router/sources';
import { evaluateKnowledgePolicy } from '@/modules/policy/knowledge-policy';

const informationNeedsSchema = z.strictObject({
  intent: z.enum(classificationIntents),
  topics: z.array(z.string().min(1).max(60)).max(10).optional(),
  riskFlags: z
    .array(z.enum(classificationRisks))
    .max(classificationRisks.length)
    .optional(),
});
export type ReplyInformationNeeds = z.infer<typeof informationNeedsSchema>;
export type ReplyKnowledgeDependencies = {
  configuration(): Promise<SourceConfiguration>;
  classify(context: PreparedReplyContext): Promise<ReplyInformationNeeds>;
  retriever: KnowledgeRetriever;
};

export function createReplyKnowledgeResolver(deps: ReplyKnowledgeDependencies) {
  return async (
    context: PreparedReplyContext,
  ): Promise<KnowledgeRetrievalResult> => {
    const configuration = await deps.configuration();
    // With no routing rules, classification cannot authorize any extra source.
    const needs = informationNeedsSchema.safeParse(
      configuration.rules.some((r) => r.enabled)
        ? await deps.classify(context)
        : { intent: 'UNKNOWN' },
    );
    if (!needs.success) throw new KnowledgeRetrievalError('INVALID_INPUT');
    const targets = context.modelInput.messages.filter((m) => m.isTarget);
    if (targets.length !== 1)
      throw new KnowledgeRetrievalError('INVALID_INPUT');
    const question = targets[0].text;
    const topics =
      needs.data.topics ??
      (context.modelInput.subject
        ? [Array.from(context.modelInput.subject).slice(0, 60).join('')]
        : []);
    const plan = routeSources(configuration, {
      query: question,
      intent: needs.data.intent,
      topics,
    });
    const authorized = new Map(
      [...plan.primarySources, ...plan.fallbackSources].map((s) => [s.id, s]),
    );
    let result: KnowledgeRetrievalResult | undefined;
    try {
      result = await deps.retriever.retrieve(
        {
          question,
          recipient: context.replyTarget.to.address,
          recipients: replyRecipientAddresses(context.replyTarget),
          intent: needs.data.intent,
          topics,
          allowedSourceIds: [...authorized.keys()],
        },
        structuredClone(plan),
      );
      const fragments = knowledgeContextSchema.safeParse(result.matches);
      if (
        !fragments.success ||
        !sameSourcePlan(result.plan, plan) ||
        knowledgeTokenUpperBound(fragments.data) >
          retrievalLimits.contextTokens ||
        fragments.data.some(
          (f) =>
            !authorized.has(f.source_id) ||
            plan.excludedSourceIds.includes(f.source_id) ||
            !audienceMatchesAll(
              f,
              context.replyTarget.to.address,
              replyRecipientAddresses(context.replyTarget),
            ),
        )
      )
        throw new KnowledgeRetrievalError('UNAVAILABLE');
      if ((await deps.configuration()).revision !== plan.revision)
        throw new SourceConfigurationError('SOURCE_CONFIGURATION_CHANGED');
      const matches = fragments.data.map((f) => ({
        ...f,
        source_title: authorized.get(f.source_id)!.title,
        source_priority: authorized.get(f.source_id)!.priority,
      }));
      const tokenUpperBound = knowledgeTokenUpperBound(matches);
      if (tokenUpperBound > retrievalLimits.contextTokens)
        throw new KnowledgeRetrievalError('UNAVAILABLE');
      return {
        ...result,
        classification: {
          intent: needs.data.intent,
          riskFlags: needs.data.riskFlags ?? [],
        },
        plan,
        matches,
        tokenUpperBound,
        allowPartialDrafts: configuration.allowPartialDrafts,
        policy:
          result.policy.action === 'REVIEW_REQUIRED'
            ? result.policy
            : evaluateKnowledgePolicy(result.review),
      };
    } finally {
      if (result) result.matches.length = 0;
    }
  };
}
