import { DataAccessError, requireUuid } from './errors';
import type { DataClient } from './models';
import type { Json } from './database.types';
import {
  generationConfiguration,
  estimateGenerationCost,
  type GenerationRecorder,
  type GenerationPricing,
  type GenerationConfiguration,
  type GenerationObservation,
} from '@/modules/analytics/generations';
import { replySourcesSchema } from '@/modules/response/sources';

export function createGenerationRecorder(
  client: DataClient,
  owner: {
    userId: string;
    gmailAccountId: string;
    emailJobId?: string;
  },
  model: {
    id: string;
    reasoningEffort?: GenerationConfiguration['reasoningEffort'];
    maxOutputTokens?: number;
  },
  pricing: GenerationPricing | null = null,
): GenerationRecorder {
  requireUuid(owner.userId);
  requireUuid(owner.gmailAccountId);
  if (owner.emailJobId) requireUuid(owner.emailJobId);
  return Object.freeze({
    async record(input: GenerationObservation) {
      requireUuid(input.id);
      if (input.context.accountId !== owner.gmailAccountId)
        throw new DataAccessError('FORBIDDEN');
      const response = input.response;
      const tokensIn = response?.inputTokens ?? null,
        tokensOut = response?.outputTokens ?? null;
      const { error } = await client.rpc('record_generation_run', {
        p_id: input.id,
        p_user_id: owner.userId,
        p_account_id: owner.gmailAccountId,
        p_job_id: owner.emailJobId,
        p_thread_id: input.context.threadId,
        p_target_message_id: input.context.targetMessageId,
        p_model: model.id,
        p_status: response?.status ?? 'FAILED',
        p_configuration: generationConfiguration(input, model) as Json,
        p_input_tokens: tokensIn ?? undefined,
        p_output_tokens: tokensOut ?? undefined,
        p_model_calls: response?.modelCalls,
        p_duration_ms: Math.max(0, Math.ceil(input.durationMs)),
        p_estimated_cost_usd:
          estimateGenerationCost(tokensIn, tokensOut, pricing) ?? undefined,
        p_pricing: pricing
          ? { ...pricing, currency: 'USD', method: 'uncached_upper_estimate' }
          : null,
        p_warnings: response?.warnings ?? [],
        p_sources_used: replySourcesSchema.parse(
          response?.sourcesUsed ?? [],
        ) as Json,
        // The RPC decides whether current, explicit authorization permits a temporary copy.
        p_body_text: response?.bodyText ?? undefined,
      });
      if (error?.message === 'FORBIDDEN')
        throw new DataAccessError('FORBIDDEN');
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
  });
}
