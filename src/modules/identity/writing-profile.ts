import { z } from 'zod';

export class WritingProfileError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_PROFILE'
      | 'EMPTY_SAMPLE'
      | 'INPUT_LIMIT_EXCEEDED'
      | 'SAMPLE_REQUIRED'
      | 'STALE_REVIEW',
  ) {
    super(code);
    this.name = 'WritingProfileError';
  }
}

export const writingProfileSchemaVersion = 2;
export const writingProfileByteLimit = 16384;
const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        value === value.trim() &&
        !/[\p{Cc}\p{Cf}\p{N}<>@]|https?:|www\./iu.test(value),
    );
const phrase = safeText(60).refine((value) => value.split(/\s+/u).length <= 6);
const phrases = z
  .array(phrase)
  .max(5)
  .refine((items) => new Set(items).size === items.length);
const common = {
  language: z
    .string()
    .max(16)
    .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  formality: z.enum(['low', 'medium', 'high', 'mixed']),
  average_length: z.enum(['short', 'medium', 'long', 'mixed']),
  preferred_greetings: phrases,
  preferred_closings: phrases,
  vocabulary: phrases,
  structure: safeText(400),
  punctuation: safeText(240),
  uses_emojis: z.boolean(),
  style_description: safeText(600),
};
// Old profiles remain readable without inventing observations for new fields.
export const legacyWritingProfileZodSchema = z.strictObject({
  schema_version: z.literal(1),
  ...common,
});
const observedLength = z.enum(['short', 'medium', 'long', 'mixed', 'unknown']);
const frequency = z.enum([
  'none',
  'occasional',
  'frequent',
  'mixed',
  'unknown',
]);
export const currentWritingProfileZodSchema = z.strictObject({
  schema_version: z.literal(writingProfileSchemaVersion),
  ...common,
  form_of_address: z.enum([
    'informal',
    'formal',
    'neutral',
    'mixed',
    'unknown',
  ]),
  tone: z.strictObject({
    warmth: z.enum(['reserved', 'neutral', 'warm', 'mixed', 'unknown']),
    directness: z.enum(['direct', 'balanced', 'indirect', 'mixed', 'unknown']),
  }),
  structure_traits: z.strictObject({
    sentence_length: observedLength,
    paragraph_length: observedLength,
    lists: frequency,
  }),
  punctuation_traits: z.strictObject({
    exclamations: frequency,
    ellipses: frequency,
    semicolons: frequency,
  }),
});
export const writingProfileZodSchema = z.discriminatedUnion('schema_version', [
  legacyWritingProfileZodSchema,
  currentWritingProfileZodSchema,
]);
export type WritingProfile = z.infer<typeof writingProfileZodSchema>;
export type CurrentWritingProfile = z.infer<
  typeof currentWritingProfileZodSchema
>;

// The model contract comes from the same schema as runtime validation.
export const writingProfileSchema = z.toJSONSchema(
  currentWritingProfileZodSchema,
  {
    target: 'draft-7',
  },
);
delete writingProfileSchema.$schema;

export function validateWritingProfile(value: unknown): WritingProfile {
  try {
    const result = writingProfileZodSchema.safeParse(value);
    if (
      result.success &&
      Buffer.byteLength(JSON.stringify(result.data)) <= writingProfileByteLimit
    )
      return result.data;
  } catch {
    // Zod errors and malformed runtime objects must not leak profile contents.
  }
  throw new WritingProfileError('INVALID_PROFILE');
}

export function parseWritingProfile(text: string): WritingProfile {
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text) > writingProfileByteLimit
  )
    throw new WritingProfileError('INVALID_PROFILE');
  try {
    return validateWritingProfile(JSON.parse(text));
  } catch {
    throw new WritingProfileError('INVALID_PROFILE');
  }
}

export function validateCurrentWritingProfile(
  value: unknown,
): CurrentWritingProfile {
  const profile = validateWritingProfile(value);
  if (profile.schema_version !== writingProfileSchemaVersion)
    throw new WritingProfileError('INVALID_PROFILE');
  return profile;
}

export function parseCurrentWritingProfile(
  text: string,
): CurrentWritingProfile {
  return validateCurrentWritingProfile(parseWritingProfile(text));
}
