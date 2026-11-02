import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ConfigurationError } from '@/config/env';
import { writingProfileZodSchema } from '@/modules/identity/writing-profile';
import {
  effectiveStylePreferences,
  stylePreferenceSchema,
} from '@/modules/identity/style-preferences';
import type { PreparedReplyContext } from '@/modules/gmail/manual-selection';
import type { KnowledgeRetrievalResult } from '@/modules/knowledge/retriever';
import type { GenerateReplyResult } from '@/modules/response/contracts';
import { responsePromptVersion } from '@/modules/response/prompts';
import { promptSecurityVersion } from '@/modules/security/prompt-injection';
import {
  responsePolicySettingsSchema,
  type ResponsePolicySettings,
} from '@/modules/policy/settings';

import { generationVersion } from './retention';
export {
  generationVersion,
  generationRetentionUpdateSchema,
} from './retention';
const revision = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .nullable();
export const generationConfigurationSchema = z.strictObject({
  version: z.literal(generationVersion),
  promptVersion: z.string().max(64),
  securityVersion: z.string().max(64),
  responseSchemaVersion: z.literal(1),
  reasoningEffort: z
    .enum(['omit', 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
    .nullable(),
  maxOutputTokens: z.int().min(1).max(1000000).nullable(),
  styleRevision: z.uuid().nullable(),
  style: writingProfileZodSchema.nullable(),
  preferences: z.array(stylePreferenceSchema).max(8),
  preferenceRevisions: z.array(z.uuid()).max(8),
  policyRevision: revision,
  policySettings: responsePolicySettingsSchema.nullable(),
  knowledgeRevision: revision,
  sourceRuleIds: z.array(z.uuid()).max(200),
  consultedSourceIds: z.array(z.uuid()).max(200),
  knowledgeFragments: z
    .array(
      z.strictObject({
        sourceId: z.uuid(),
        documentId: z.uuid(),
        chunkId: z.uuid(),
        version: z.int().min(1).max(2147483647),
      }),
    )
    .max(8),
  examplesUsed: z.int().min(0).max(3),
  allowEmailHistory: z.boolean(),
  allowPartialDrafts: z.boolean(),
  userInstructionsHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
export type GenerationConfiguration = z.infer<
  typeof generationConfigurationSchema
>;
export type GenerationPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};
export function readGenerationPricing(
  env: Record<string, string | undefined>,
): GenerationPricing | null {
  const names = [
    'OPENAI_INPUT_USD_PER_MILLION',
    'OPENAI_OUTPUT_USD_PER_MILLION',
  ] as const;
  if (names.every((name) => !env[name])) return null;
  if (
    names.some(
      (name) =>
        !/^\d+(?:\.\d{1,8})?$/.test(env[name] ?? '') ||
        Number(env[name]) > 1000000,
    )
  )
    throw new ConfigurationError([...names]);
  return {
    inputUsdPerMillion: Number(env[names[0]]),
    outputUsdPerMillion: Number(env[names[1]]),
  };
}
export function estimateGenerationCost(
  input: number | null,
  output: number | null,
  pricing: GenerationPricing | null,
) {
  if (input === null || output === null || !pricing) return null;
  // Conservative estimate: all input tokens are priced at the uncached rate.
  return (
    Math.ceil(
      (input * pricing.inputUsdPerMillion +
        output * pricing.outputUsdPerMillion) *
        100,
    ) / 100000000
  );
}
export type GenerationObservation = {
  id: string;
  context: PreparedReplyContext;
  response: GenerateReplyResult | null;
  knowledge?: KnowledgeRetrievalResult;
  durationMs: number;
  userInstructions?: readonly string[];
  policySettings?: ResponsePolicySettings;
};
export interface GenerationRecorder {
  record(input: GenerationObservation): Promise<void>;
}
export function generationConfiguration(
  input: GenerationObservation,
  model: {
    reasoningEffort?: GenerationConfiguration['reasoningEffort'];
    maxOutputTokens?: number;
  },
): GenerationConfiguration {
  return generationConfigurationSchema.parse({
    version: generationVersion,
    promptVersion: responsePromptVersion,
    securityVersion: promptSecurityVersion,
    responseSchemaVersion: 1,
    reasoningEffort: model.reasoningEffort ?? null,
    maxOutputTokens: model.maxOutputTokens ?? null,
    styleRevision: input.context.styleRevision ?? null,
    style: input.context.modelInput.style,
    preferences: input.response
      ? effectiveStylePreferences(
          input.context.stylePreferences?.preferences,
          input.userInstructions,
        )
      : (input.context.stylePreferences?.preferences ?? []),
    preferenceRevisions: input.context.stylePreferences?.revisions ?? [],
    policyRevision: input.response?.policyRevision ?? null,
    policySettings: input.policySettings ?? null,
    knowledgeRevision: input.knowledge?.plan.revision ?? null,
    sourceRuleIds: input.knowledge?.plan.matchedRuleIds ?? [],
    consultedSourceIds: input.knowledge?.consultedSourceIds ?? [],
    knowledgeFragments:
      input.knowledge?.matches.map((f) => ({
        sourceId: f.source_id,
        documentId: f.document_id,
        chunkId: f.chunk_id,
        version: f.version,
      })) ?? [],
    examplesUsed: input.response?.examplesUsed ?? 0,
    allowEmailHistory: input.knowledge?.plan.allowEmailHistory ?? false,
    allowPartialDrafts: input.knowledge?.allowPartialDrafts ?? false,
    userInstructionsHash: input.userInstructions?.length
      ? createHash('sha256')
          .update(JSON.stringify(input.userInstructions))
          .digest('hex')
      : null,
  });
}
