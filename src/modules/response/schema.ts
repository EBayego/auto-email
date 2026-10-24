import { z } from 'zod';
import {
  ResponseGenerationError,
  responseLimits,
  type GeneratedResponse,
} from './contracts';
import { retrievalLimits } from '@/modules/knowledge/retriever';

export const modelWarnings = [
  'MISSING_INFORMATION',
  'UNSUPPORTED_FACT',
  'UNSUPPORTED_COMMITMENT',
  'HIGH_RISK',
  'PROMPT_INJECTION',
  'NO_REPLY_REQUIRED',
  'LANGUAGE_MISMATCH',
  'UNANSWERED_QUESTION',
  'STYLE_PREFERENCE_MISMATCH',
] as const;

const safeText = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(
      (value) =>
        value === value.trim() &&
        value.isWellFormed() &&
        !/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\t\r\n\u200c\u200d]/gu, '')),
    );
const evidenceFields = { quote: safeText(400, 4), claim: safeText(400) };
const modelWarningSchema = z
  .array(z.enum(modelWarnings))
  .max(8)
  .refine((items) => new Set(items).size === items.length);
const generatedShape = z.strictObject({
  status: z.enum(['READY', 'PARTIAL', 'INSUFFICIENT_CONTEXT', 'BLOCKED']),
  bodyText: safeText(responseLimits.bodyCharacters).nullable(),
  language: z
    .string()
    .max(16)
    .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  missingInformation: z.array(safeText(240)).max(8),
  evidence: z
    .array(
      z.union([
        z.strictObject({
          messageIndex: z
            .int()
            .min(0)
            .max(responseLimits.messages - 1),
          ...evidenceFields,
        }),
        z.strictObject({
          knowledgeIndex: z
            .int()
            .min(0)
            .max(retrievalLimits.fragments - 1),
          ...evidenceFields,
        }),
      ]),
    )
    .max(12),
  warnings: modelWarningSchema,
});
export const generatedResponseZodSchema = generatedShape.refine((value) => {
  if (value.status === 'READY' || value.status === 'PARTIAL') {
    return (
      value.bodyText !== null &&
      !value.warnings.length &&
      (value.status === 'READY'
        ? !value.missingInformation.length
        : !!value.missingInformation.length && !!value.evidence.length) &&
      !/<\/?[a-z][^>]*>|\[(?:TODO|DATO|NOMBRE|PRECIO|FECHA|INSERT|PLACEHOLDER)[^\]]*\]/iu.test(
        value.bodyText,
      ) &&
      !/^(?:to|from|cc|bcc|subject|reply-to):/im.test(value.bodyText)
    );
  }
  return (
    value.bodyText === null &&
    !value.evidence.length &&
    (value.status === 'BLOCKED'
      ? !!value.warnings.length
      : !!value.missingInformation.length)
  );
});
const verificationShape = z.strictObject({
  verdict: z.enum(['SUPPORTED', 'INSUFFICIENT_CONTEXT', 'BLOCKED']),
  issues: modelWarningSchema,
});
const verificationSchema = verificationShape.refine((value) =>
  value.verdict === 'SUPPORTED' ? !value.issues.length : !!value.issues.length,
);
// JSON Schema and runtime validation share their structural source. State
// invariants are checked locally after Structured Outputs has constrained JSON.
export const generatedResponseSchema = z.toJSONSchema(generatedShape, {
  target: 'draft-7',
});
export const responseVerificationSchema = z.toJSONSchema(verificationShape, {
  target: 'draft-7',
});
delete generatedResponseSchema.$schema;
delete responseVerificationSchema.$schema;

export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function parse<T>(schema: z.ZodType<T>, input: string): T {
  try {
    if (typeof input !== 'string' || Buffer.byteLength(input) > 40000)
      throw new Error();
    return schema.parse(JSON.parse(input));
  } catch {
    throw new ResponseGenerationError('INVALID_RESPONSE');
  }
}
export function parseGeneratedResponse(input: string): GeneratedResponse {
  return parse(generatedResponseZodSchema, input);
}
export function parseResponseVerification(input: string) {
  return parse(verificationSchema, input);
}
