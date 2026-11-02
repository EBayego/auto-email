import { z } from 'zod';
export const replyComparisonVersion = 'mail058-v1';
export const comparisonLimits = Object.freeze({
  characters: 16000,
  tokens: 2000,
});
const count = z.int().min(0).max(32000);
const ratio = z.number().min(0).max(1);
const salutation = z.enum(['NONE', 'SHORT', 'FORMAL', 'GRATITUDE', 'WARM']);
export const replyComparisonSchema = z.strictObject({
  version: z.literal(replyComparisonVersion),
  classification: z.enum([
    'UNCHANGED',
    'STYLE_ONLY',
    'FACTUAL_REVIEW',
    'CONTENT_REVIEW',
  ]),
  learningEligible: z.boolean(),
  significantChange: z.boolean(),
  originalCharacters: count,
  sentCharacters: count,
  originalWords: count,
  sentWords: count,
  originalTokens: count,
  sentTokens: count,
  insertedTokens: count,
  deletedTokens: count,
  substitutedTokens: count,
  editDistance: count,
  similarity: ratio,
  editRatio: ratio,
  effortRatio: z.number().min(0).max(comparisonLimits.tokens),
  lengthDelta: z.int().min(-32000).max(32000),
  vocabularyAdded: count,
  vocabularyRemoved: count,
  greetingChanged: z.boolean(),
  closingChanged: z.boolean(),
  originalGreeting: salutation,
  sentGreeting: salutation,
  originalClosing: salutation,
  sentClosing: salutation,
  formattingChanged: z.boolean(),
  punctuationChanged: z.boolean(),
  attachmentsChanged: z.boolean(),
  factualSignals: z
    .array(
      z.enum([
        'QUANTITIES',
        'CALENDAR',
        'CONTACTS',
        'LINKS',
        'NEGATION',
        'COMMITMENTS',
        'ENTITIES',
        'ADDRESSEE',
      ]),
    )
    .max(8),
});
export type ReplyComparison = z.infer<typeof replyComparisonSchema>;
export class ReplyComparisonError extends Error {
  constructor(public readonly code: 'LIMIT_EXCEEDED' | 'UNSUPPORTED_CONTENT') {
    super(code);
    this.name = 'ReplyComparisonError';
  }
}
export function normalizeComparisonText(text: string) {
  if (typeof text !== 'string' || !text.isWellFormed())
    throw new ReplyComparisonError('UNSUPPORTED_CONTENT');
  if (text.length > comparisonLimits.characters)
    throw new ReplyComparisonError('LIMIT_EXCEEDED');
  const normalized = text
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u200b\ufeff]/gu, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (normalized.length > comparisonLimits.characters)
    throw new ReplyComparisonError('LIMIT_EXCEEDED');
  return normalized;
}
const flat = (s: string) => s.replace(/\s+/gu, ' ').trim();
const words = (s: string) =>
  s.match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
const tokens = (s: string) =>
  s.match(/[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*|[^\s]/gu) ?? [];
const round = (n: number) => Math.round(n * 1000000) / 1000000;
// Unit-cost token Levenshtein; ties prefer diagonal, then deletion, then insertion.
// Two rows bound memory and the fixed token limit bounds CPU independently of input.
function edits(a: readonly string[], b: readonly string[]) {
  let previous = Array.from({ length: 4 }, () => new Uint16Array(b.length + 1));
  let current = Array.from({ length: 4 }, () => new Uint16Array(b.length + 1));
  for (let j = 0; j <= b.length; j++) {
    previous[0][j] = j;
    previous[1][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    current.forEach((row) => {
      row[0] = 0;
    });
    current[0][0] = i;
    current[2][0] = i;
    for (let j = 1; j <= b.length; j++) {
      const different = Number(a[i - 1] !== b[j - 1]);
      const diagonal = previous[0][j - 1] + different,
        deletion = previous[0][j] + 1,
        insertion = current[0][j - 1] + 1;
      if (diagonal <= deletion && diagonal <= insertion) {
        for (let k = 0; k < 4; k++) current[k][j] = previous[k][j - 1];
        current[0][j] = diagonal;
        current[3][j] += different;
      } else if (deletion <= insertion) {
        for (let k = 0; k < 4; k++) current[k][j] = previous[k][j];
        current[0][j] = deletion;
        current[2][j]++;
      } else {
        for (let k = 0; k < 4; k++) current[k][j] = current[k][j - 1];
        current[0][j] = insertion;
        current[1][j]++;
      }
    }
    [previous, current] = [current, previous];
  }
  return {
    editDistance: previous[0][b.length],
    insertedTokens: previous[1][b.length],
    deletedTokens: previous[2][b.length],
    substitutedTokens: previous[3][b.length],
  };
}
type Salutation = z.infer<typeof salutation>;
const folded = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function sections(text: string) {
  const lines = text.split('\n');
  let greeting: Salutation = 'NONE',
    closing: Salutation = 'NONE',
    greetingText = '',
    closingText = '',
    addressee = '';
  const first = lines.findIndex((line) => !!line);
  const match =
    first < 0
      ? null
      : lines[first].match(
          /^(hola|buenos días|buenas tardes|buenas noches|hi|hello|bonjour|dear|estimad[oa]s?)(?:[ ,:¡!.-]+(.*?))?[,:!.]*$/iu,
        );
  if (match) {
    const tail = (match[2] ?? '').replace(/[,!.:]+$/gu, '').trim();
    // Only bounded proper names may follow a greeting. Free text stays content.
    if (
      !tail ||
      /^(?:\p{Lu}[\p{Ll}\p{M}]+)(?:[ -]\p{Lu}[\p{Ll}\p{M}]+){0,2}$/u.test(tail)
    ) {
      greeting = /^(dear|estimad)/iu.test(match[1]) ? 'FORMAL' : 'SHORT';
      addressee = tail;
      greetingText = lines[first];
      lines[first] = '';
    }
  }
  const last = lines.findLastIndex((line) => !!line);
  if (last >= 0) {
    const ending = folded(lines[last])
      .replace(/[,.!¡]+$/gu, '')
      .trim();
    const groups: [Salutation, readonly string[]][] = [
      [
        'SHORT',
        [
          'un saludo',
          'saludos',
          'regards',
          'best regards',
          'kind regards',
          'cordialement',
          'bien cordialement',
        ],
      ],
      ['FORMAL', ['atentamente', 'sincerely', 'yours sincerely']],
      [
        'GRATITUDE',
        [
          'gracias',
          'muchas gracias',
          'gracias y un saludo',
          'thanks',
          'thank you',
          'merci',
        ],
      ],
      ['WARM', ['un abrazo', 'hasta pronto', 'cheers']],
    ];
    const found = groups.find(([, values]) => values.includes(ending));
    if (found) {
      closing = found[0];
      closingText = lines[last];
      lines[last] = '';
    }
  }
  return {
    greeting,
    closing,
    greetingText,
    closingText,
    addressee,
    body: flat(lines.join('\n')),
  };
}
function signature(text: string, pattern: RegExp) {
  return JSON.stringify((text.match(pattern) ?? []).map(folded).sort());
}
const factPatterns = {
  QUANTITIES:
    /[+\-−]?\d+(?:[.,:/-]\d+)*|[%€$£]|\b(?:euros?|dólares?|dollars?|USD|EUR|GBP|kilogramos?|kilómetros?|por ciento|percent)\b/giu,
  CALENDAR:
    /\b(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|hoy|mañana|ayer|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|january|february|march|april|may|june|july|august|september|october|november|december)\b/giu,
  CONTACTS: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu,
  LINKS: /https?:\/\/[^\s<>]+|www\.[^\s<>]+/giu,
  NEGATION:
    /\b(?:no|not|never|nunca|jamás|sin|without|cannot|can't|don't|won't|tampoco)\b/giu,
  COMMITMENTS:
    /\b(?:confirmo|confirmamos|garantizo|garantizamos|prometo|prometemos|acepto|rechazo|cancelado|cancelamos|aprobado|aprobamos|confirm|guarantee|promise|approved|rejected|cancelled)\b/giu,
  ENTITIES: /\p{Lu}[\p{L}\p{M}]+/gu,
} as const;
export function compareReplies(
  originalBody: string,
  sentBody: string,
  options: { attachmentsChanged?: boolean } = {},
): ReplyComparison {
  const original = normalizeComparisonText(originalBody),
    sent = normalizeComparisonText(sentBody);
  if (!original || !sent) throw new ReplyComparisonError('UNSUPPORTED_CONTENT');
  const a = tokens(original),
    b = tokens(sent);
  if (a.length > comparisonLimits.tokens || b.length > comparisonLimits.tokens)
    throw new ReplyComparisonError('LIMIT_EXCEEDED');
  const diff = edits(a, b),
    left = sections(original),
    right = sections(sent);
  const factualSignals: ReplyComparison['factualSignals'] = [];
  for (const key of Object.keys(factPatterns) as (keyof typeof factPatterns)[])
    if (
      signature(left.body, factPatterns[key]) !==
      signature(right.body, factPatterns[key])
    )
      factualSignals.push(key);
  if (left.addressee !== right.addressee) factualSignals.push('ADDRESSEE');
  const originalVocabulary = new Set(words(original).map(folded)),
    sentVocabulary = new Set(words(sent).map(folded));
  const editRatio = round(diff.editDistance / Math.max(a.length, b.length, 1));
  const unchanged = original === sent && !options.attachmentsChanged;
  // Only fixed salutations/closings and whitespace are eligible. Lexical,
  // punctuation, entity and factual edits always require content review.
  const safeStyle =
    !unchanged &&
    !factualSignals.length &&
    left.body === right.body &&
    !options.attachmentsChanged;
  const classification: ReplyComparison['classification'] = unchanged
    ? 'UNCHANGED'
    : factualSignals.length
      ? 'FACTUAL_REVIEW'
      : safeStyle
        ? 'STYLE_ONLY'
        : 'CONTENT_REVIEW';
  return replyComparisonSchema.parse({
    version: replyComparisonVersion,
    classification,
    learningEligible: safeStyle,
    significantChange:
      !!factualSignals.length ||
      !!options.attachmentsChanged ||
      editRatio >= 0.25,
    originalCharacters: Array.from(original).length,
    sentCharacters: Array.from(sent).length,
    originalWords: words(original).length,
    sentWords: words(sent).length,
    originalTokens: a.length,
    sentTokens: b.length,
    ...diff,
    similarity: round(1 - editRatio),
    editRatio,
    effortRatio: round(diff.editDistance / Math.max(a.length, 1)),
    lengthDelta: Array.from(sent).length - Array.from(original).length,
    vocabularyAdded: [...sentVocabulary].filter(
      (w) => !originalVocabulary.has(w),
    ).length,
    vocabularyRemoved: [...originalVocabulary].filter(
      (w) => !sentVocabulary.has(w),
    ).length,
    greetingChanged: left.greetingText !== right.greetingText,
    closingChanged: left.closingText !== right.closingText,
    originalGreeting: left.greeting,
    sentGreeting: right.greeting,
    originalClosing: left.closing,
    sentClosing: right.closing,
    formattingChanged: original !== sent && flat(original) === flat(sent),
    punctuationChanged:
      signature(left.body, /[^\p{L}\p{M}\p{N}\s]/gu) !==
        signature(right.body, /[^\p{L}\p{M}\p{N}\s]/gu) ||
      (left.body !== right.body &&
        JSON.stringify(words(left.body)) === JSON.stringify(words(right.body))),
    attachmentsChanged: options.attachmentsChanged ?? false,
    factualSignals,
  });
}
