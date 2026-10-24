import { z } from 'zod';
import {
  classificationDecisions,
  classificationIntents,
  classificationRisks,
  type EmailClassification,
} from '@/modules/classifier/contracts';

export const emailJobStatuses = [
  'PENDING',
  'CLASSIFYING',
  'SKIPPED',
  'GENERATING',
  'DRAFT_CREATED',
  'REVIEW_REQUIRED',
  'FAILED',
] as const;
export type EmailJobStatus = (typeof emailJobStatuses)[number];
const transitions: Record<EmailJobStatus, readonly EmailJobStatus[]> = {
  PENDING: ['CLASSIFYING'],
  CLASSIFYING: [
    'PENDING',
    'SKIPPED',
    'GENERATING',
    'REVIEW_REQUIRED',
    'FAILED',
  ],
  GENERATING: ['DRAFT_CREATED', 'SKIPPED', 'REVIEW_REQUIRED', 'FAILED'],
  FAILED: ['PENDING'],
  SKIPPED: [],
  DRAFT_CREATED: [],
  REVIEW_REQUIRED: [],
};
export function canTransitionEmailJob(
  from: EmailJobStatus,
  to: EmailJobStatus,
): boolean {
  return transitions[from]?.includes(to) ?? false;
}
const categorical = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const count = z.int().min(0).max(2147483647);
export const jobClassificationSchema = z.strictObject({
  decision: z.enum(classificationDecisions),
  intent: z.enum(classificationIntents),
  reasons: z.array(categorical).min(1).max(32),
  riskFlags: z
    .array(z.enum(classificationRisks))
    .max(classificationRisks.length),
  needsAttachment: z.boolean(),
  source: z.enum(['RULE', 'MODEL']),
  modelCalls: count,
  inputTokens: count,
  outputTokens: count,
});
export type JobClassification = z.infer<typeof jobClassificationSchema>;
export function jobClassification(
  result: EmailClassification,
): JobClassification {
  const {
    decision,
    intent,
    reasons,
    riskFlags,
    needsAttachment,
    source,
    modelCalls,
    inputTokens,
    outputTokens,
  } = result;
  return jobClassificationSchema.parse({
    decision,
    intent,
    reasons,
    riskFlags,
    needsAttachment,
    source,
    modelCalls,
    inputTokens,
    outputTokens,
  });
}
export class EmailJobError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'LEASE_LOST') {
    super(code);
    this.name = 'EmailJobError';
  }
}
