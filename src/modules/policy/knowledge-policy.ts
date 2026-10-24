import { z } from 'zod';
import type { KnowledgeReview } from '@/modules/knowledge/provenance';

export const knowledgePolicySchema = z
  .object({
    action: z.enum(['ALLOW_DRAFT', 'REVIEW_REQUIRED']),
    reasons: z
      .array(z.enum(['KNOWLEDGE_CONFLICT', 'KNOWLEDGE_NOT_CURRENT']))
      .max(2),
  })
  .strict()
  .refine((p) =>
    p.action === 'ALLOW_DRAFT' ? p.reasons.length === 0 : p.reasons.length > 0,
  );
export type KnowledgePolicyResult = z.infer<typeof knowledgePolicySchema>;
export function evaluateKnowledgePolicy(
  review: KnowledgeReview,
): KnowledgePolicyResult {
  if (
    review.incomplete ||
    review.conflicts.some((c) => c.resolution === 'UNRESOLVED')
  )
    return { action: 'REVIEW_REQUIRED', reasons: ['KNOWLEDGE_CONFLICT'] };
  const excluded = new Set(review.omitted.map((r) => r.reference_id));
  if (
    review.references.length &&
    review.references.every((r) => excluded.has(r.reference_id))
  )
    return { action: 'REVIEW_REQUIRED', reasons: ['KNOWLEDGE_NOT_CURRENT'] };
  return { action: 'ALLOW_DRAFT', reasons: [] };
}
