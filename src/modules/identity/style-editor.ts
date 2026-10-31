import { z } from 'zod';
import {
  normalizeStyleScope,
  styleScopeSchema,
  type StyleScope,
} from './contextual-style';
import {
  parseStyleInstructions,
  preferenceOptions,
  stylePreferenceSchema,
  validatePreferenceSet,
  type StylePreference,
  type StoredStylePreference,
} from './style-preferences';
import type { WritingProfile } from './writing-profile';

export type StyleProfileView = {
  scope: StyleScope;
  revision: string;
  parentRevision: string | null;
  version: number;
  generatedAt: string;
  sampleSize: number;
  reviewed: boolean;
  profile: WritingProfile;
  current: boolean;
  inactiveReason:
    | 'GENERAL_CHANGED'
    | 'RULES_CHANGED'
    | 'EXPIRED'
    | 'GENERAL_UNREVIEWED'
    | null;
};
export type StyleEditorSnapshot = {
  generalRevision: string;
  profiles: StyleProfileView[];
  preferences: StoredStylePreference[];
};
export const scopeIdentity = (scope: StyleScope) =>
  JSON.stringify([scope.kind, scope.key]);
export function scopeLabel(scope: StyleScope) {
  if (scope.kind === 'GENERAL') return 'Estilo general';
  if (scope.kind === 'RECIPIENT') return `Destinatario: ${scope.key}`;
  if (scope.kind === 'DOMAIN') return `Dominio: ${scope.key}`;
  return {
    CLIENT: 'Clientes',
    COLLEAGUE: 'Compañeros',
    SUPPLIER: 'Proveedores',
    MANAGEMENT: 'Dirección',
    OTHER: 'Otras relaciones',
  }[scope.key];
}
export const styleFields = [
  {
    key: 'warmth',
    label: 'Tono y calidez',
    options: {
      reserved: 'Reservado',
      neutral: 'Cordial',
      warm: 'Cercano y cálido',
    },
  },
  {
    key: 'formality',
    label: 'Formalidad',
    options: { informal: 'Informal', neutral: 'Neutral', formal: 'Formal' },
  },
  {
    key: 'length',
    label: 'Longitud',
    options: { short: 'Breve', medium: 'Media', long: 'Detallada' },
  },
  {
    key: 'greeting',
    label: 'Saludos',
    options: {
      short: 'Saludo breve',
      none: 'Sin saludo',
      natural: 'Adaptar de forma natural',
    },
  },
  {
    key: 'closing',
    label: 'Despedidas',
    options: {
      short: 'Despedida breve',
      none: 'Sin despedida',
      natural: 'Adaptar de forma natural',
    },
  },
  {
    key: 'language',
    label: 'Idioma de respuesta',
    options: {
      recipient: 'Idioma del destinatario',
      es: 'Español',
      en: 'Inglés',
      fr: 'Francés',
      de: 'Alemán',
      it: 'Italiano',
      pt: 'Portugués',
      ca: 'Catalán',
    },
  },
  {
    key: 'emojis',
    label: 'Emojis',
    options: { never: 'No utilizar', allowed: 'Permitir cuando encajen' },
  },
  {
    key: 'help_offer',
    label: 'Ofrecimiento final de ayuda',
    options: { none: 'No añadir', natural: 'Añadir cuando encaje' },
  },
] as const;
export type PreferenceDraft = Record<keyof typeof preferenceOptions, string>;
export const emptyPreferenceDraft = (): PreferenceDraft =>
  Object.fromEntries(
    styleFields.map((field) => [field.key, '']),
  ) as PreferenceDraft;
export const readableStyleValue = (value: string | undefined) =>
  (
    ({
      low: 'Baja',
      medium: 'Media',
      high: 'Alta',
      mixed: 'Variable',
      short: 'Breve',
      long: 'Extensa',
      reserved: 'Reservado',
      neutral: 'Neutral',
      warm: 'Cercano y cálido',
      direct: 'Directo',
      balanced: 'Equilibrado',
      indirect: 'Indirecto',
      informal: 'Informal',
      formal: 'Formal',
      unknown: 'Evidencia insuficiente',
      es: 'Español',
      en: 'Inglés',
      fr: 'Francés',
      de: 'Alemán',
      it: 'Italiano',
      pt: 'Portugués',
      ca: 'Catalán',
    }) as Record<string, string>
  )[value ?? ''] ??
  value ??
  'No disponible en este perfil';
export const styleEditorMessages: Record<string, string> = {
  NOT_CONNECTED: 'Conecta o reactiva Gmail antes de modificar tu estilo.',
  STYLE_PROFILE_REQUIRED:
    'Primero prepara tu perfil de escritura desde Primeros pasos.',
  STALE_STYLE:
    'El perfil aprendido ha cambiado. Recarga la configuración antes de guardar.',
  STALE_PREFERENCE:
    'Las preferencias han cambiado en otra ventana. Recarga la configuración antes de guardar.',
  CONTEXT_NOT_CURRENT:
    'Este perfil contextual ya no está vigente. El asistente utilizará el perfil general.',
  GENERAL_PROFILE_REQUIRED: 'Revisa y confirma primero el perfil general.',
  INVALID_INPUT: 'Revisa los ajustes seleccionados.',
  INVALID_INSTRUCTIONS:
    'No hemos podido interpretar alguna instrucción. Prueba con los ejemplos de saludo, tono, longitud, idioma o emojis; no se aplicará ningún cambio parcial.',
  CONFLICTING_INSTRUCTIONS:
    'Hay instrucciones distintas para un mismo ajuste. Deja una sola opción por característica.',
  UNAVAILABLE: 'No se ha podido completar la operación. Vuelve a intentarlo.',
};
export class StyleEditorError extends Error {
  constructor(public readonly code: keyof typeof styleEditorMessages) {
    super(code);
    this.name = 'StyleEditorError';
  }
}
const common = {
  scope: styleScopeSchema,
  generalRevision: z.uuid(),
  profileRevision: z.uuid().nullable(),
  expectedRevisions: z
    .array(z.uuid())
    .max(8)
    .refine((values) => new Set(values).size === values.length),
};
const operationSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('save'),
    ...common,
    preferences: z.array(stylePreferenceSchema).max(8),
  }),
  z.strictObject({ action: z.literal('restore'), ...common }),
  z.strictObject({
    action: z.literal('confirm'),
    ...common,
    reviewed: z.literal(true),
  }),
]);
export function parseStyleEditorOperation(input: unknown) {
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success) throw new StyleEditorError('INVALID_INPUT');
  const operation = {
    ...parsed.data,
    scope: normalizeStyleScope(parsed.data.scope),
  };
  if (operation.action === 'save') {
    try {
      operation.preferences = validatePreferenceSet(operation.preferences);
    } catch {
      throw new StyleEditorError('INVALID_INPUT');
    }
  }
  return operation;
}
export type StyleEditorOperation = ReturnType<typeof parseStyleEditorOperation>;
const normalized = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[!¡¿?]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
const aliases: Record<string, StylePreference> = {
  'sin emojis': { key: 'emojis', value: 'never' },
  'no incluyas emojis': { key: 'emojis', value: 'never' },
  'permite emojis': { key: 'emojis', value: 'allowed' },
  'se breve': { key: 'length', value: 'short' },
  've al grano': { key: 'length', value: 'short' },
  'escribe respuestas cortas': { key: 'length', value: 'short' },
  'respuestas breves': { key: 'length', value: 'short' },
  'respuestas detalladas': { key: 'length', value: 'long' },
  'sin saludo': { key: 'greeting', value: 'none' },
  'no saludes': { key: 'greeting', value: 'none' },
  'no uses saludos': { key: 'greeting', value: 'none' },
  'saludos breves': { key: 'greeting', value: 'short' },
  'sin despedida': { key: 'closing', value: 'none' },
  'no uses despedidas': { key: 'closing', value: 'none' },
  'despedidas breves': { key: 'closing', value: 'short' },
  'tono formal': { key: 'formality', value: 'formal' },
  'escribe con formalidad': { key: 'formality', value: 'formal' },
  'tono informal': { key: 'formality', value: 'informal' },
  'tono neutro': { key: 'formality', value: 'neutral' },
  'usa un tono cercano': { key: 'warmth', value: 'warm' },
  'escribe de forma cercana': { key: 'warmth', value: 'warm' },
  'tono calido': { key: 'warmth', value: 'warm' },
  'se cordial': { key: 'warmth', value: 'neutral' },
  'tono reservado': { key: 'warmth', value: 'reserved' },
  'tono sobrio': { key: 'warmth', value: 'reserved' },
  'no ofrezcas ayuda al final': { key: 'help_offer', value: 'none' },
  'no anadas un ofrecimiento final de ayuda': {
    key: 'help_offer',
    value: 'none',
  },
  'responde en el idioma del destinatario': {
    key: 'language',
    value: 'recipient',
  },
};
export function parseEditorInstructions(text: string): StylePreference[] {
  if (
    typeof text !== 'string' ||
    text.length > 2000 ||
    /[\p{Cc}\p{Cf}]/u.test(text.replace(/[\r\n\t]/g, ''))
  )
    throw new StyleEditorError('INVALID_INSTRUCTIONS');
  const clauses = text
    .split(/[\r\n.;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (clauses.length > 8) throw new StyleEditorError('INVALID_INSTRUCTIONS');
  const result: StylePreference[] = [];
  for (const clause of clauses) {
    try {
      result.push(...parseStyleInstructions([clause]));
      continue;
    } catch {
      /* Try the short, style-only expressions below. */
    }
    const parts = clause.split(
      /\s+y\s+(?=(?:no |usa |responde |escribe |se |sin |ve ))/i,
    );
    for (const part of parts) {
      const key = normalized(part);
      if (key === 'sin saludo ni despedida') {
        result.push(
          { key: 'greeting', value: 'none' },
          { key: 'closing', value: 'none' },
        );
        continue;
      }
      if (aliases[key]) result.push(aliases[key]);
      else {
        try {
          result.push(...parseStyleInstructions([part]));
        } catch {
          throw new StyleEditorError('INVALID_INSTRUCTIONS');
        }
      }
    }
  }
  const chosen = new Map<string, StylePreference>();
  for (const preference of result) {
    const old = chosen.get(preference.key);
    if (old && old.value !== preference.value)
      throw new StyleEditorError('CONFLICTING_INSTRUCTIONS');
    chosen.set(preference.key, preference);
  }
  return validatePreferenceSet([...chosen.values()]);
}
