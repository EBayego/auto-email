import { z } from 'zod';
import {
  classificationDecisions,
  classificationIntents,
  classificationRisks,
  modelReasonCodes,
} from './contracts';

export const modelClassificationSchema = z.strictObject({
  decision: z.enum(classificationDecisions),
  intent: z.enum(classificationIntents),
  reasons: z.array(z.enum(modelReasonCodes)).min(1).max(4),
  riskFlags: z
    .array(z.enum(classificationRisks))
    .max(classificationRisks.length),
  needsAttachment: z.boolean(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});
export type ModelClassification = z.infer<typeof modelClassificationSchema>;
export const classificationJsonSchema = z.toJSONSchema(
  modelClassificationSchema,
  { target: 'draft-7' },
);
delete classificationJsonSchema.$schema;

const replyReasons = [
  'EXPLICIT_QUESTION',
  'ACTION_REQUEST',
  'CONFIRMATION_REQUEST',
  'FOLLOW_UP_REQUEST',
];
const noReplyReasons = [
  'INFORMATION_ONLY',
  'ACKNOWLEDGEMENT_ONLY',
  'AUTOMATED_NOTIFICATION',
  'NEWSLETTER_CONTENT',
  'NO_RESPONSE_EXPECTED',
];
export function parseModelClassification(
  text: string,
): ModelClassification | null {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8192) return null;
  try {
    const parsed = modelClassificationSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const result = parsed.data;
    if (
      new Set(result.reasons).size !== result.reasons.length ||
      new Set(result.riskFlags).size !== result.riskFlags.length ||
      (result.decision === 'REPLY_REQUIRED' &&
        (!result.reasons.some((reason) => replyReasons.includes(reason)) ||
          result.reasons.some((reason) => noReplyReasons.includes(reason)))) ||
      (result.decision === 'NO_REPLY' &&
        (!result.reasons.some((reason) => noReplyReasons.includes(reason)) ||
          result.reasons.some((reason) => replyReasons.includes(reason))))
    )
      return null;
    return result;
  } catch {
    return null;
  }
}
