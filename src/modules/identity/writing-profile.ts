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

const phrase = { type: 'string', minLength: 1, maxLength: 60 };
const phrases = { type: 'array', items: phrase, maxItems: 5 };
const properties = {
  schema_version: { type: 'integer', enum: [1] },
  language: {
    type: 'string',
    pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$',
    maxLength: 16,
  },
  formality: { type: 'string', enum: ['low', 'medium', 'high', 'mixed'] },
  average_length: {
    type: 'string',
    enum: ['short', 'medium', 'long', 'mixed'],
  },
  preferred_greetings: phrases,
  preferred_closings: phrases,
  vocabulary: phrases,
  structure: { type: 'string', minLength: 1, maxLength: 400 },
  punctuation: { type: 'string', minLength: 1, maxLength: 240 },
  uses_emojis: { type: 'boolean' },
  style_description: { type: 'string', minLength: 1, maxLength: 600 },
} as const;
export const writingProfileSchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};
export type WritingProfile = {
  schema_version: 1;
  language: string;
  formality: 'low' | 'medium' | 'high' | 'mixed';
  average_length: 'short' | 'medium' | 'long' | 'mixed';
  preferred_greetings: string[];
  preferred_closings: string[];
  vocabulary: string[];
  structure: string;
  punctuation: string;
  uses_emojis: boolean;
  style_description: string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const safeText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= max &&
  value === value.trim() &&
  !/[\p{Cc}\p{Cf}\p{N}<>@]|https?:|www\./iu.test(value);

export function validateWritingProfile(value: unknown): WritingProfile {
  if (
    !record(value) ||
    Object.keys(value).length !== Object.keys(properties).length ||
    Object.keys(properties).some((key) => !Object.hasOwn(value, key)) ||
    value.schema_version !== 1 ||
    typeof value.language !== 'string' ||
    value.language.length > 16 ||
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value.language) ||
    !properties.formality.enum.includes(
      value.formality as WritingProfile['formality'],
    ) ||
    !properties.average_length.enum.includes(
      value.average_length as WritingProfile['average_length'],
    ) ||
    typeof value.uses_emojis !== 'boolean' ||
    !safeText(value.structure, 400) ||
    !safeText(value.punctuation, 240) ||
    !safeText(value.style_description, 600)
  )
    throw new WritingProfileError('INVALID_PROFILE');
  const list = (key: string) => {
    const items = value[key];
    if (
      !Array.isArray(items) ||
      items.length > 5 ||
      items.some(
        (item) => !safeText(item, 60) || item.split(/\s+/u).length > 6,
      ) ||
      new Set(items).size !== items.length
    )
      throw new WritingProfileError('INVALID_PROFILE');
    return [...items] as string[];
  };
  return {
    schema_version: 1,
    language: value.language,
    formality: value.formality as WritingProfile['formality'],
    average_length: value.average_length as WritingProfile['average_length'],
    preferred_greetings: list('preferred_greetings'),
    preferred_closings: list('preferred_closings'),
    vocabulary: list('vocabulary'),
    structure: value.structure,
    punctuation: value.punctuation,
    uses_emojis: value.uses_emojis,
    style_description: value.style_description,
  };
}

export function parseWritingProfile(text: string): WritingProfile {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 8192)
    throw new WritingProfileError('INVALID_PROFILE');
  try {
    return validateWritingProfile(JSON.parse(text));
  } catch {
    throw new WritingProfileError('INVALID_PROFILE');
  }
}
