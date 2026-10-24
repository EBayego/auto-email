import { z } from 'zod';
import {
  classificationIntents,
  classificationRisks,
} from '@/modules/classifier/contracts';
import {
  normalizeClassifierAddress,
  normalizeClassifierDomain,
} from '@/modules/classifier/rules';
import { normalizeSourceTopic } from '@/modules/source-router/route-sources';

export const responsePolicyVersion = 'mail045-v1' as const;
export const sourceRequirementKinds = [
  'PRICE',
  'DEADLINE',
  'HOURS',
  'PROCEDURE',
  'FACT',
] as const;
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const address = z
  .string()
  .max(254)
  .refine((s) => {
    try {
      normalizeClassifierAddress(s);
      return true;
    } catch {
      return false;
    }
  });
const domain = z
  .string()
  .max(253)
  .refine((s) => {
    try {
      normalizeClassifierDomain(s);
      return true;
    } catch {
      return false;
    }
  });
export const responsePolicySettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  blockedSenders: z.array(address).max(50).refine(unique),
  blockedDomains: z.array(domain).max(50).refine(unique),
  blockedCategories: z
    .array(z.enum(classificationIntents))
    .max(classificationIntents.length)
    .refine(unique),
  blockedTopics: z
    .array(
      z
        .string()
        .min(1)
        .max(80)
        .refine((s) => !!normalizeSourceTopic(s) && !/[\p{Cc}\p{Cf}]/u.test(s)),
    )
    .max(30)
    .refine(unique),
  sourceRequirements: z
    .array(
      z.strictObject({
        kind: z.enum(sourceRequirementKinds),
        sourceIds: z.array(z.uuid()).min(1).max(20).refine(unique),
      }),
    )
    .max(sourceRequirementKinds.length)
    .refine((items) => unique(items.map((i) => i.kind))),
});
export type ResponsePolicySettings = z.infer<
  typeof responsePolicySettingsSchema
>;
export function normalizeResponsePolicySettings(
  input: unknown,
): ResponsePolicySettings {
  const value = responsePolicySettingsSchema.parse(input);
  const sorted = (items: string[]) => [...new Set(items)].sort();
  return {
    ...value,
    blockedSenders: sorted(
      value.blockedSenders.map(normalizeClassifierAddress),
    ),
    blockedDomains: sorted(value.blockedDomains.map(normalizeClassifierDomain)),
    blockedCategories: [...value.blockedCategories].sort(),
    blockedTopics: sorted(value.blockedTopics.map(normalizeSourceTopic)),
    sourceRequirements: value.sourceRequirements
      .map((r) => ({ ...r, sourceIds: sorted(r.sourceIds) }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
  };
}
export const defaultResponsePolicySettings = (): ResponsePolicySettings => ({
  schemaVersion: 1,
  blockedSenders: [],
  blockedDomains: [],
  blockedCategories: [],
  blockedTopics: [],
  sourceRequirements: [],
});
export const policyContextSchema = z.strictObject({
  sender: address.optional(),
  category: z.enum(classificationIntents).optional(),
  additionalCategories: z
    .array(z.enum(classificationIntents))
    .max(classificationIntents.length)
    .optional(),
  riskFlags: z
    .array(z.enum(classificationRisks))
    .max(classificationRisks.length)
    .refine(unique)
    .optional(),
});
export type ResponsePolicyContext = z.infer<typeof policyContextSchema>;
export const policyReasons = [
  'SENDER_BLOCKED',
  'CATEGORY_BLOCKED',
  'TOPIC_BLOCKED',
  'POLICY_CONTEXT_REQUIRED',
  'PAYMENT_REQUIRES_REVIEW',
  'CONTRACT_REQUIRES_REVIEW',
  'DISCOUNT_REQUIRES_REVIEW',
  'SENSITIVE_CATEGORY',
  'PROMPT_INJECTION',
  'REQUIRED_SOURCE_MISSING',
  'UNVERIFIED_DEADLINE',
  'UNVERIFIED_COMMITMENT',
  'POLICY_CHANGED',
] as const;
export const responsePolicyEvaluationSchema = z
  .strictObject({
    version: z.literal(responsePolicyVersion),
    phase: z.enum(['PREFLIGHT', 'POSTFLIGHT']),
    action: z.enum(['ALLOW_DRAFT', 'REVIEW_REQUIRED', 'BLOCK']),
    reasons: z
      .array(z.enum(policyReasons))
      .max(policyReasons.length)
      .refine(unique),
  })
  .refine((e) =>
    e.action === 'ALLOW_DRAFT' ? e.reasons.length === 0 : e.reasons.length > 0,
  );
export type ResponsePolicyEvaluation = z.infer<
  typeof responsePolicyEvaluationSchema
>;
export function mergePolicyEvaluations(
  phase: ResponsePolicyEvaluation['phase'],
  evaluations: ResponsePolicyEvaluation[],
): ResponsePolicyEvaluation {
  const checked = evaluations.map((value) =>
    responsePolicyEvaluationSchema.parse(value),
  );
  return {
    version: responsePolicyVersion,
    phase,
    action: checked.some((e) => e.action === 'BLOCK')
      ? 'BLOCK'
      : checked.some((e) => e.action === 'REVIEW_REQUIRED')
        ? 'REVIEW_REQUIRED'
        : 'ALLOW_DRAFT',
    reasons: [...new Set(checked.flatMap((e) => e.reasons))],
  };
}
export type ResponsePolicySnapshot = {
  revision: string;
  settings: ResponsePolicySettings;
};
