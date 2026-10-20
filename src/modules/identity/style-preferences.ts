import { z } from 'zod';
import {
  normalizeStyleScope,
  relationshipFor,
  type RelationshipRule,
  type StyleScope,
} from './contextual-style';

export const preferenceOptions = {
  greeting: ['short', 'none', 'natural'],
  language: ['recipient', 'es', 'en', 'fr', 'de', 'it', 'pt', 'ca'],
  length: ['short', 'medium', 'long'],
  formality: ['informal', 'neutral', 'formal'],
  closing: ['short', 'none', 'natural'],
  emojis: ['never', 'allowed'],
  warmth: ['reserved', 'neutral', 'warm'],
  help_offer: ['none', 'natural'],
} as const;
export const preferenceKeys = Object.keys(
  preferenceOptions,
) as (keyof typeof preferenceOptions)[];
export const stylePreferenceSchema = z.discriminatedUnion('key', [
  z.strictObject({
    key: z.literal('greeting'),
    value: z.enum(preferenceOptions.greeting),
  }),
  z.strictObject({
    key: z.literal('language'),
    value: z.enum(preferenceOptions.language),
  }),
  z.strictObject({
    key: z.literal('length'),
    value: z.enum(preferenceOptions.length),
  }),
  z.strictObject({
    key: z.literal('formality'),
    value: z.enum(preferenceOptions.formality),
  }),
  z.strictObject({
    key: z.literal('closing'),
    value: z.enum(preferenceOptions.closing),
  }),
  z.strictObject({
    key: z.literal('emojis'),
    value: z.enum(preferenceOptions.emojis),
  }),
  z.strictObject({
    key: z.literal('warmth'),
    value: z.enum(preferenceOptions.warmth),
  }),
  z.strictObject({
    key: z.literal('help_offer'),
    value: z.enum(preferenceOptions.help_offer),
  }),
]);
export type StylePreference = z.infer<typeof stylePreferenceSchema>;
export type ScopedStylePreference = {
  scope: StyleScope;
  preference: StylePreference;
};
export type StoredStylePreference = ScopedStylePreference & {
  revision: string;
  origin: 'EXPLICIT';
};
export type ResolvedStylePreferences = {
  preferences: StylePreference[];
  revisions: string[];
};
export function validateResolvedStylePreferences(
  input: ResolvedStylePreferences,
): ResolvedStylePreferences {
  const preferences = validatePreferenceSet(input?.preferences);
  if (
    !Array.isArray(input.revisions) ||
    input.revisions.length !== preferences.length ||
    input.revisions.some((revision) => !z.uuid().safeParse(revision).success) ||
    new Set(input.revisions).size !== input.revisions.length
  )
    throw new StylePreferenceError('INVALID_PREFERENCE');
  return { preferences, revisions: [...input.revisions].sort() };
}
export const stylePreferenceLimit = 200;
export class StylePreferenceError extends Error {
  constructor(
    public readonly code:
      'INVALID_PREFERENCE' | 'CONFLICTING_PREFERENCES' | 'STALE_PREFERENCE',
  ) {
    super(code);
    this.name = 'StylePreferenceError';
  }
}
export function validateStylePreference(input: unknown): StylePreference {
  const result = stylePreferenceSchema.safeParse(input);
  if (!result.success) throw new StylePreferenceError('INVALID_PREFERENCE');
  return result.data;
}
export function validatePreferenceSet(input: unknown): StylePreference[] {
  if (!Array.isArray(input) || input.length > preferenceKeys.length)
    throw new StylePreferenceError('INVALID_PREFERENCE');
  const result = input.map(validateStylePreference);
  if (new Set(result.map((p) => p.key)).size !== result.length)
    throw new StylePreferenceError('CONFLICTING_PREFERENCES');
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
export function validateScopedPreference(
  input: ScopedStylePreference,
): ScopedStylePreference {
  return {
    scope: normalizeStyleScope(input?.scope),
    preference: validateStylePreference(input?.preference),
  };
}
export function resolveStylePreferences(
  rows: readonly StoredStylePreference[],
  recipient: string,
  rules: readonly RelationshipRule[] = [],
): ResolvedStylePreferences {
  if (rows.length > stylePreferenceLimit)
    throw new StylePreferenceError('INVALID_PREFERENCE');
  const target = normalizeStyleScope({ kind: 'RECIPIENT', key: recipient });
  const category = relationshipFor(target.key, rules);
  const scopes: StyleScope[] = [
    { kind: 'GENERAL', key: '' },
    { kind: 'DOMAIN', key: target.key.split('@')[1] },
    ...(category ? [{ kind: 'RELATIONSHIP' as const, key: category }] : []),
    target,
  ];
  const chosen = new Map<string, StoredStylePreference>();
  const seen = new Set<string>();
  for (const row of rows) {
    const value = validateScopedPreference(row);
    if (row.origin !== 'EXPLICIT' || !z.uuid().safeParse(row.revision).success)
      throw new StylePreferenceError('INVALID_PREFERENCE');
    const identity = JSON.stringify([
      value.scope.kind,
      value.scope.key,
      value.preference.key,
    ]);
    if (seen.has(identity))
      throw new StylePreferenceError('CONFLICTING_PREFERENCES');
    seen.add(identity);
  }
  for (const scope of scopes)
    for (const row of rows) {
      const value = validateScopedPreference(row);
      if (scope.kind === value.scope.kind && scope.key === value.scope.key)
        chosen.set(row.preference.key, row);
    }
  const selected = [...chosen.values()].sort((a, b) =>
    a.preference.key.localeCompare(b.preference.key),
  );
  return {
    preferences: selected.map((row) => validateStylePreference(row.preference)),
    revisions: selected.map((row) => row.revision).sort(),
  };
}
const instructions: Record<string, string> = {
  'greeting:short': 'Usa un saludo breve.',
  'greeting:none': 'No uses saludo.',
  'greeting:natural': 'Adapta el saludo de forma natural.',
  'language:recipient': 'Responde siempre en el idioma del cliente.',
  'language:es': 'Responde en español.',
  'language:en': 'Responde en inglés.',
  'language:fr': 'Responde en francés.',
  'language:de': 'Responde en alemán.',
  'language:it': 'Responde en italiano.',
  'language:pt': 'Responde en portugués.',
  'language:ca': 'Responde en catalán.',
  'length:short': 'Usa una respuesta breve.',
  'length:medium': 'Usa una respuesta de longitud media.',
  'length:long': 'Usa una respuesta detallada.',
  'formality:informal': 'Usa un tono informal.',
  'formality:neutral': 'Usa un tono neutro.',
  'formality:formal': 'Usa un tono formal.',
  'closing:short': 'Usa una despedida breve.',
  'closing:none': 'No uses despedida.',
  'closing:natural': 'Adapta la despedida de forma natural.',
  'emojis:never': 'No uses emojis.',
  'emojis:allowed': 'Puedes usar emojis si resultan apropiados.',
  'warmth:reserved': 'Usa un tono reservado y poco expresivo.',
  'warmth:neutral': 'Usa un tono cordial de expresividad moderada.',
  'warmth:warm':
    'Usa un tono cercano y cálido, con saludo y despedida expresivos y naturales cuando estén permitidos.',
  'help_offer:none': 'No añadas un ofrecimiento final de ayuda.',
  'help_offer:natural':
    'Incluye cuando encaje una fórmula cordial de disposición a continuar, sin prometer acciones, disponibilidad ni servicios concretos.',
};
export const renderStylePreference = (value: StylePreference): string => {
  const p = validateStylePreference(value);
  return instructions[`${p.key}:${p.value}`];
};
const normalized = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[.!¡¿?]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
// Legacy per-generation instructions are style-only and share the same allowlist.
// No arbitrary stored prompt text, factual authorization or security exceptions.
export function parseStyleInstructions(
  input: readonly string[] = [],
): StylePreference[] {
  if (!Array.isArray(input) || input.length > 5)
    throw new StylePreferenceError('INVALID_PREFERENCE');
  return validatePreferenceSet(
    input.map((text) => {
      if (typeof text !== 'string' || text.length > 300)
        throw new StylePreferenceError('INVALID_PREFERENCE');
      const entry = Object.entries(instructions).find(
        ([, phrase]) => normalized(phrase) === normalized(text),
      );
      if (normalized(text) === 'no uses saludos largos')
        return { key: 'greeting', value: 'short' };
      if (!entry) throw new StylePreferenceError('INVALID_PREFERENCE');
      const [key, value] = entry[0].split(':');
      return validateStylePreference({ key, value });
    }),
  );
}
export function effectiveStylePreferences(
  stored: unknown = [],
  perRequest: readonly string[] = [],
): StylePreference[] {
  const merged = new Map(validatePreferenceSet(stored).map((p) => [p.key, p]));
  for (const p of parseStyleInstructions(perRequest)) merged.set(p.key, p);
  return validatePreferenceSet([...merged.values()]);
}
export function violatesStylePreferences(
  body: string,
  preferences: readonly StylePreference[],
): boolean {
  const lines = body
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  return preferences.some(
    (p) =>
      (p.key === 'greeting' &&
        p.value === 'none' &&
        /^[¡¿\s]*(?:hola|buenos días|buenas tardes|hello|hi|dear|bonjour|salut|guten tag|ciao|olá)\b/iu.test(
          lines[0] ?? '',
        )) ||
      (p.key === 'closing' &&
        p.value === 'none' &&
        /^[¡¿\s]*(?:un saludo|saludos|atentamente|kind regards|best regards|regards|cordialement)\b/iu.test(
          lines.at(-1) ?? '',
        )) ||
      (p.key === 'help_offer' &&
        p.value === 'none' &&
        /\b(?:si necesitas algo|cualquier cosa me dices|let me know if|if you need anything|happy to help)\b/iu.test(
          body,
        )) ||
      (p.key === 'emojis' &&
        p.value === 'never' &&
        /\p{Extended_Pictographic}|\uFE0F/u.test(body)),
  );
}
