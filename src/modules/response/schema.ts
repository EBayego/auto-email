import {
  ResponseGenerationError,
  responseLimits,
  type GeneratedResponse,
  type ResponseWarning,
} from './contracts';

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
const missing = {
  type: 'array',
  maxItems: 8,
  items: { type: 'string', minLength: 1, maxLength: 240 },
};
const properties = {
  status: {
    type: 'string',
    enum: ['READY', 'INSUFFICIENT_CONTEXT', 'BLOCKED'],
  },
  bodyText: {
    type: ['string', 'null'],
    maxLength: responseLimits.bodyCharacters,
  },
  language: {
    type: 'string',
    pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$',
    maxLength: 16,
  },
  missingInformation: missing,
  evidence: {
    type: 'array',
    maxItems: 12,
    items: {
      type: 'object',
      properties: {
        messageIndex: {
          type: 'integer',
          minimum: 0,
          maximum: responseLimits.messages - 1,
        },
        quote: { type: 'string', minLength: 4, maxLength: 400 },
        claim: { type: 'string', minLength: 1, maxLength: 400 },
      },
      required: ['messageIndex', 'quote', 'claim'],
      additionalProperties: false,
    },
  },
  warnings: {
    type: 'array',
    maxItems: 8,
    items: { type: 'string', enum: modelWarnings },
  },
};
export const generatedResponseSchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};
const verificationProperties = {
  verdict: {
    type: 'string',
    enum: ['SUPPORTED', 'INSUFFICIENT_CONTEXT', 'BLOCKED'],
  },
  issues: {
    type: 'array',
    maxItems: 8,
    items: { type: 'string', enum: modelWarnings },
  },
};
export const responseVerificationSchema = {
  type: 'object',
  properties: verificationProperties,
  required: Object.keys(verificationProperties),
  additionalProperties: false,
};
const invalid = (): never => {
  throw new ResponseGenerationError('INVALID_RESPONSE');
};
export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> =>
  record(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, max: number, min = 1): value is string =>
  typeof value === 'string' &&
  value === value.trim() &&
  value.length >= min &&
  value.length <= max &&
  !/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\t\r\n]/gu, ''));
const warnings = (value: unknown): value is ResponseWarning[] =>
  Array.isArray(value) &&
  value.length <= 8 &&
  value.every((item) => modelWarnings.includes(item)) &&
  new Set(value).size === value.length;
function json(input: string): unknown {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 40000)
    return invalid();
  try {
    return JSON.parse(input);
  } catch {
    return invalid();
  }
}

export function parseGeneratedResponse(input: string): GeneratedResponse {
  const value = json(input);
  if (
    !keys(value, Object.keys(properties)) ||
    !['READY', 'INSUFFICIENT_CONTEXT', 'BLOCKED'].includes(
      String(value.status),
    ) ||
    typeof value.language !== 'string' ||
    value.language.length > 16 ||
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value.language) ||
    !Array.isArray(value.missingInformation) ||
    value.missingInformation.length > 8 ||
    !value.missingInformation.every((item) => text(item, 240)) ||
    !Array.isArray(value.evidence) ||
    value.evidence.length > 12 ||
    !warnings(value.warnings)
  )
    return invalid();
  const evidence = value.evidence.map((entry: unknown) => {
    if (
      !keys(entry, ['messageIndex', 'quote', 'claim']) ||
      !Number.isInteger(entry.messageIndex) ||
      (entry.messageIndex as number) < 0 ||
      (entry.messageIndex as number) >= responseLimits.messages ||
      !text(entry.quote, 400, 4) ||
      !text(entry.claim, 400)
    )
      return invalid();
    return {
      messageIndex: entry.messageIndex as number,
      quote: entry.quote,
      claim: entry.claim,
    };
  });
  if (value.status === 'READY') {
    if (
      !text(value.bodyText, responseLimits.bodyCharacters) ||
      value.missingInformation.length ||
      value.warnings.length ||
      /<\/?[a-z][^>]*>|\[(?:TODO|DATO|NOMBRE|PRECIO|FECHA|INSERT|PLACEHOLDER)[^\]]*\]/iu.test(
        value.bodyText,
      ) ||
      /^(?:to|from|cc|bcc|subject|reply-to):/im.test(value.bodyText)
    )
      return invalid();
  } else if (
    value.bodyText !== null ||
    evidence.length ||
    (value.status === 'INSUFFICIENT_CONTEXT' &&
      !value.missingInformation.length) ||
    (value.status === 'BLOCKED' && !value.warnings.length)
  )
    return invalid();
  return {
    status: value.status as GeneratedResponse['status'],
    bodyText: value.bodyText as string | null,
    language: value.language,
    missingInformation: [...value.missingInformation] as string[],
    evidence,
    warnings: [...value.warnings],
  };
}

export function parseResponseVerification(input: string) {
  const value = json(input);
  if (
    !keys(value, Object.keys(verificationProperties)) ||
    !['SUPPORTED', 'INSUFFICIENT_CONTEXT', 'BLOCKED'].includes(
      String(value.verdict),
    ) ||
    !warnings(value.issues) ||
    (value.verdict === 'SUPPORTED'
      ? value.issues.length !== 0
      : value.issues.length === 0)
  )
    return invalid();
  return {
    verdict: value.verdict as 'SUPPORTED' | 'INSUFFICIENT_CONTEXT' | 'BLOCKED',
    issues: [...value.issues],
  };
}
