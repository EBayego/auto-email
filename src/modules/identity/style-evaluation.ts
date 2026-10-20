import { createHash } from 'node:crypto';
import { z } from 'zod';
import { detectReplyLanguage } from '@/modules/response/language';
import type { WritingProfile } from './writing-profile';

export const evaluationModes = [
  'UNPERSONALIZED',
  'GENERAL',
  'CONTEXTUAL',
] as const;
export type EvaluationMode = (typeof evaluationModes)[number];
export const styleDimensions = [
  'greeting',
  'formality',
  'vocabulary',
  'length',
  'language',
] as const;
export type StyleDimension = (typeof styleDimensions)[number];
const id = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);
export const evaluationCaseSchema = z.strictObject({
  threadId: id,
  targetMessageId: id,
  replyMessageId: id,
});
export type EvaluationCaseReference = z.infer<typeof evaluationCaseSchema>;
export const evaluationCorpusSchema = z.strictObject({
  version: z.literal(1),
  userId: z.uuid(),
  gmailAccountId: z.uuid(),
  seed: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  cases: z.array(evaluationCaseSchema).min(10).max(20),
  training: z.strictObject({
    after: z.iso.datetime(),
    before: z.iso.datetime(),
    targetSize: z.int().min(200).max(500),
    sourceMessages: z
      .array(z.strictObject({ id, threadId: id }))
      .min(10)
      .max(500),
  }),
});
export type StyleEvaluationCorpus = z.infer<typeof evaluationCorpusSchema>;
export class StyleEvaluationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_EVALUATION'
      | 'ACCOUNT_MISMATCH'
      | 'EXPIRED_EVALUATION'
      | 'CONTAMINATED_HOLDOUT'
      | 'INVALID_HISTORICAL_PAIR'
      | 'TRAINING_REQUIRED'
      | 'INCOMPLETE_REVIEW'
      | 'INVALID_AUTOMATIC_REVIEW',
  ) {
    super(code);
    this.name = 'StyleEvaluationError';
  }
}
export function validateEvaluationCorpus(
  value: unknown,
  owner: { userId: string; gmailAccountId: string },
  now = new Date(),
): StyleEvaluationCorpus {
  const result = evaluationCorpusSchema.safeParse(value);
  if (!result.success || !Number.isFinite(now.getTime()))
    throw new StyleEvaluationError('INVALID_EVALUATION');
  const c = result.data;
  if (c.userId !== owner.userId || c.gmailAccountId !== owner.gmailAccountId)
    throw new StyleEvaluationError('ACCOUNT_MISMATCH');
  const created = Date.parse(c.createdAt),
    expires = Date.parse(c.expiresAt);
  if (
    created > now.getTime() ||
    expires <= created ||
    expires - created > 90 * 86400000
  )
    throw new StyleEvaluationError('INVALID_EVALUATION');
  if (expires <= now.getTime())
    throw new StyleEvaluationError('EXPIRED_EVALUATION');
  const holdoutThreads = new Set(c.cases.map((item) => item.threadId));
  const heldIds = c.cases.flatMap((item) => [
    item.targetMessageId,
    item.replyMessageId,
  ]);
  if (
    holdoutThreads.size !== c.cases.length ||
    new Set(heldIds).size !== heldIds.length ||
    new Set(c.training.sourceMessages.map((ref) => ref.id)).size !==
      c.training.sourceMessages.length ||
    Date.parse(c.training.after) >= Date.parse(c.training.before) ||
    Date.parse(c.training.before) > created
  )
    throw new StyleEvaluationError('INVALID_EVALUATION');
  if (
    c.training.sourceMessages.some(
      (ref) => holdoutThreads.has(ref.threadId) || heldIds.includes(ref.id),
    )
  )
    throw new StyleEvaluationError('CONTAMINATED_HOLDOUT');
  return c;
}
export const evaluationFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function blindOrder(seed: string, caseId: string): EvaluationMode[] {
  return [...evaluationModes].sort((a, b) =>
    evaluationFingerprint([seed, caseId, a]).localeCompare(
      evaluationFingerprint([seed, caseId, b]),
    ),
  );
}
const tokens = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/\p{L}+/gu) ?? [];
const greeting = (text: string) =>
  text
    .trim()
    .match(
      /^(hola|buenos días|buenas tardes|hello|hi|dear|bonjour|salut|guten tag|ciao|olá)\b/iu,
    )?.[0]
    .toLowerCase() ?? 'none';
const formality = (text: string) =>
  /\b(?:usted|ustedes|estimad[oa]s?|atentamente|dear|sincerely)\b/iu.test(text)
    ? 'formal'
    : /\b(?:tú|tu|oye|hola|hi|cheers)\b/iu.test(text)
      ? 'informal'
      : 'undetermined';
// These are transparent lexical proxies, never human style-quality scores.
export function measureStyle(reference: string, candidate: string) {
  const original = tokens(reference),
    generated = tokens(candidate);
  const vocabulary = (items: string[]) =>
    new Set(items.filter((word) => word.length > 3));
  const a = vocabulary(original),
    b = vocabulary(generated);
  const union = new Set([...a, ...b]);
  const referenceLanguage = detectReplyLanguage(reference),
    candidateLanguage = detectReplyLanguage(candidate);
  const referenceFormality = formality(reference),
    candidateFormality = formality(candidate);
  return {
    greetingMatch: greeting(reference) === greeting(candidate),
    formalityMatch:
      referenceFormality === 'undetermined' ||
      candidateFormality === 'undetermined'
        ? null
        : referenceFormality === candidateFormality,
    vocabularyJaccard: union.size
      ? [...a].filter((word) => b.has(word)).length / union.size
      : null,
    referenceWords: original.length,
    candidateWords: generated.length,
    lengthRatio: original.length ? generated.length / original.length : null,
    languageMatch:
      referenceLanguage && candidateLanguage
        ? referenceLanguage === candidateLanguage
        : null,
  };
}
const grade = z.int().min(1).max(5);
export const humanStyleRatingSchema = z.strictObject({
  scores: z.strictObject({
    greeting: grade,
    formality: grade,
    vocabulary: grade,
    length: grade,
    language: grade,
  }),
  acceptable: z.boolean(),
  safe: z.boolean(),
  factors: z
    .array(
      z.enum([
        ...styleDimensions,
        'irrelevant_examples',
        'profile_mismatch',
        'unsupported_content',
      ]),
    )
    .max(8),
});
export type HumanStyleRating = z.infer<typeof humanStyleRatingSchema>;
export const validateHumanStyleRating = (value: unknown): HumanStyleRating => {
  const result = humanStyleRatingSchema.safeParse(value);
  if (
    !result.success ||
    new Set(result.data.factors).size !== result.data.factors.length
  )
    throw new StyleEvaluationError('INCOMPLETE_REVIEW');
  return result.data;
};
export const identityMvpPolicy = Object.freeze({
  configuration: 'EXPLICIT_PREFERENCES_THEN_CONTEXTUAL_WITH_GENERAL_FALLBACK',
  evidenceStatus: 'AUTOMATIC_EVALUATION_WITH_RESERVED_REPLIES',
  historicalExamples: 3,
  decisionRule:
    'APPLY_EXPLICIT_PREFERENCES_AND_KEEP_GENERAL_FALLBACK_WITH_INSUFFICIENT_CONTEXT',
  humanEvaluationRequired: false,
  draftHumanReviewRequired: true,
});
export type EvaluationProfile = {
  profile: WritingProfile;
  scope: string;
  fingerprint: string;
};
