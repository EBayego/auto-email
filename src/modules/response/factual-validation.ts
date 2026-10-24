import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PreparedReplyContext } from '@/modules/gmail/manual-selection';
import { audienceMatchesAll } from '@/modules/knowledge/audience';
import { knowledgeCurrency } from '@/modules/knowledge/provenance';
import type {
  GenerateReplyInput,
  GeneratedResponse,
  GenerateReplyResult,
  ResponseWarning,
  ResponseGenerationResult,
} from './contracts';
import { prepareGenerateReplyInput } from './context';
import { finalizeReplyResult } from './result';

export const factualValidationVersion = 'mail046-v1' as const;
export const factualKinds = [
  'AMOUNT',
  'DATE',
  'QUANTITY',
  'CONDITION',
  'COMMITMENT',
  'FACT',
] as const;
export const factualReasons = [
  'MISSING_EVIDENCE',
  'INVALID_CITATION',
  'VALUE_MISMATCH',
  'CONDITION_MISMATCH',
  'TOPIC_MISMATCH',
  'RECIPIENT_MISMATCH',
  'SOURCE_NOT_CURRENT',
  'UNAUTHORIZED_COMMITMENT',
  'SEMANTIC_REJECTION',
  'VALIDATION_CHANGED',
  'INVALID_VALUE',
  'AMBIGUOUS_DATE',
] as const;
export const factualIssueSchema = z
  .strictObject({
    claimIndex: z.int().min(0).max(5999),
    kind: z.enum(factualKinds),
    reason: z.enum(factualReasons),
    start: z.int().min(0).max(5999),
    end: z.int().min(1).max(6000),
  })
  .refine((v) => v.end > v.start);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const factualAuditSchema = z
  .strictObject({
    version: z.literal(factualValidationVersion),
    status: z.enum(['SUPPORTED', 'REVIEW_REQUIRED']),
    bodyHash: hashSchema,
    contextHash: hashSchema,
    recipientHash: hashSchema,
    evidenceHash: hashSchema,
    claimCount: z.int().min(0).max(6000),
    issues: z.array(factualIssueSchema).max(32),
  })
  .refine(
    (v) =>
      (v.status === 'SUPPORTED') === (v.issues.length === 0) &&
      v.issues.every((i) => i.claimIndex < v.claimCount),
  );
export type FactualAudit = z.infer<typeof factualAuditSchema>;
export type FactualValidation = FactualAudit & {
  claims: {
    text: string;
    kind: (typeof factualKinds)[number];
    start: number;
    end: number;
  }[];
  missingInformation: string[];
};
export interface FactualValidationAccess {
  record(
    context: PreparedReplyContext,
    validation: FactualAudit,
    evaluationId: string,
  ): Promise<void>;
}
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const recipients = (input: GenerateReplyInput) =>
  [
    ...new Set(
      [
        ...(input.recipient ? [input.recipient] : []),
        ...(input.recipients ?? []),
      ].map((a) => a.toLowerCase()),
    ),
  ].sort();
const contextHash = (input: GenerateReplyInput) =>
  digest({
    subject: input.conversation.subject,
    messages: input.conversation.messages,
    ...(recipients(input).length > 1
      ? { messageAudiences: input.messageAudiences }
      : {}),
  });
const recipientHash = (input: GenerateReplyInput) =>
  digest({
    primary: input.recipient?.toLowerCase() ?? null,
    recipients: recipients(input),
  });
// A copied JSON verdict cannot authorize Gmail. Keep only hashes in this seal.
const evidenceHash = (
  response: Pick<ResponseGenerationResult, 'evidence' | 'knowledgeReferences'>,
) =>
  digest({
    evidence: response.evidence,
    references: response.knowledgeReferences?.map((r) => ({
      index: r.knowledgeIndex,
      sourceId: r.sourceId,
      documentId: r.documentId,
      version: r.version,
      chunkId: r.chunkId,
    })),
  });
const seals = new WeakMap<FactualValidation, string>();
const fingerprint = (v: FactualAudit) => digest(factualAuditSchema.parse(v));
export function factualAudit(validation: FactualValidation): FactualAudit {
  const {
    claims: _claims,
    missingInformation: _missing,
    ...audit
  } = validation;
  void _claims;
  void _missing;
  return factualAuditSchema.parse(audit);
}
const normalize = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u200c\u200d]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
const literal = (s: string) =>
  s.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const words: Record<string, string> = Object.fromEntries(
  [
    ['un', 'una', 'uno', 'one'],
    ['dos', 'two'],
    ['tres', 'three'],
    ['cuatro', 'four'],
    ['cinco', 'five'],
    ['seis', 'six'],
    ['siete', 'seven'],
    ['ocho', 'eight'],
    ['nueve', 'nine'],
    ['diez', 'ten'],
    ['once', 'eleven'],
    ['doce', 'twelve'],
    ['trece', 'thirteen'],
    ['catorce', 'fourteen'],
    ['quince', 'fifteen'],
    ['dieciseis', 'sixteen'],
    ['diecisiete', 'seventeen'],
    ['dieciocho', 'eighteen'],
    ['diecinueve', 'nineteen'],
    ['veinte', 'twenty'],
    ['veintiuno'],
    ['veintidos'],
    ['veintitres'],
    ['veinticuatro'],
    ['veinticinco'],
    ['veintiseis'],
    ['veintisiete'],
    ['veintiocho'],
    ['veintinueve'],
    ['treinta', 'thirty'],
  ].flatMap((names, i) => names.map((name) => [name, String(i + 1)])),
);
const units: Record<string, string> = {
  euro: 'EUR',
  euros: 'EUR',
  eur: 'EUR',
  '€': 'EUR',
  dolar: 'USD',
  dolares: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  usd: 'USD',
  $: 'USD',
  gbp: 'GBP',
  '£': 'GBP',
  dia: 'DAY',
  dias: 'DAY',
  day: 'DAY',
  days: 'DAY',
  hora: 'HOUR',
  horas: 'HOUR',
  hour: 'HOUR',
  hours: 'HOUR',
  semana: 'WEEK',
  semanas: 'WEEK',
  week: 'WEEK',
  weeks: 'WEEK',
  mes: 'MONTH',
  meses: 'MONTH',
  month: 'MONTH',
  months: 'MONTH',
  ano: 'YEAR',
  anos: 'YEAR',
  year: 'YEAR',
  years: 'YEAR',
  unidad: 'UNIT',
  unidades: 'UNIT',
  unit: 'UNIT',
  units: 'UNIT',
  persona: 'PERSON',
  personas: 'PERSON',
  person: 'PERSON',
  people: 'PERSON',
  plaza: 'SEAT',
  plazas: 'SEAT',
  licencia: 'LICENSE',
  licencias: 'LICENSE',
  license: 'LICENSE',
  licenses: 'LICENSE',
  '%': 'PERCENT',
  porciento: 'PERCENT',
  'por ciento': 'PERCENT',
  percent: 'PERCENT',
  kg: 'KG',
  kilogramo: 'KG',
  kilogramos: 'KG',
  kilogram: 'KG',
  kilograms: 'KG',
  g: 'G',
  gramo: 'G',
  gramos: 'G',
  gram: 'G',
  grams: 'G',
  l: 'L',
  litro: 'L',
  litros: 'L',
  liter: 'L',
  liters: 'L',
  m: 'M',
  metro: 'M',
  metros: 'M',
  cm: 'CM',
  mm: 'MM',
  km: 'KM',
  mb: 'MB',
  gb: 'GB',
  kwh: 'KWH',
};
const quantity = `(?:[-+]?\\d+(?:[.,]\\d+)*|${Object.keys(words).join('|')})`;
const unitPattern = Object.keys(units).join('|');
function number(s: string) {
  if (words[s]) return words[s];
  // Normalize unambiguous monetary formats; preserve ambiguous representations.
  if (/^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?$/u.test(s)) {
    const decimal = s.match(/[.,](\d{2})$/u);
    return (
      s.slice(0, decimal ? -3 : undefined).replace(/[.,]/gu, '') +
      (decimal ? `.${decimal[1]}` : '')
    );
  }
  return s.replace(',', '.');
}
function values(text: string) {
  const s = normalize(text).replace(
    /([-+])\s*(eur|usd|gbp|[€$£])\s*(?=\d)/gu,
    (_all, sign: string, currency: string) => `${currency}${sign}`,
  );
  const result = new Set<string>();
  let rest = s.replace(
    new RegExp(
      `(?:(eur|usd|gbp|[€$£])\\s*)?(${quantity})\\s*(${unitPattern})(?![\\p{L}])`,
      'gu',
    ),
    (all, prefix: string | undefined, n: string, u: string) => {
      result.add(`${units[prefix ?? u]}:${number(n)}`);
      return ' '.repeat(all.length);
    },
  );
  rest = rest.replace(
    new RegExp(`(eur|usd|gbp|[€$£])\\s*(${quantity})`, 'gu'),
    (all, u: string, n: string) => {
      result.add(`${units[u]}:${number(n)}`);
      return ' '.repeat(all.length);
    },
  );
  for (const match of rest.matchAll(
    /(?<![\p{L}\p{N}])[-+]?\d+(?:[.,:/-]\d+)*\b|\b(?:hoy|manana|ayer|lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b|https?:\/\/[^\s<>]+|[^\s<>@]+@[^\s<>@]+/gu,
  ))
    result.add(match[0].replace(/[.,;!?)]*$/u, ''));
  return result;
}
function invalidValue(text: string) {
  const validDate = (y: number, m: number, d: number) =>
    y > 0 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <=
      [
        31,
        y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
      ][m - 1];
  return (
    [...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu)].some(
      (m) => !validDate(+m[1], +m[2], +m[3]),
    ) ||
    [...text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/gu)].some(
      (m) => !validDate(+m[3], +m[2], +m[1]) && !validDate(+m[3], +m[1], +m[2]),
    ) ||
    [...text.matchAll(/\b(\d{1,2}):(\d{2})\b/gu)].some(
      (m) => +m[1] > 23 || +m[2] > 59,
    )
  );
}
const commitment =
  /\b(?:(?:we|i)\s+(?:can|will|shall|offer|provide|agree|accept|guarantee|promise)|podemos|ofrecemos|aceptamos|garantizamos|revisaremos|enviaremos|me comprometo|nos comprometemos|estoy disponible|estamos disponibles|nuestro equipo)\b/iu;
const money =
  /\b(?:euros?|eur|usd|gbp|d[oó]lares?|dollars?|libras?|pesos)\b|[€$£%]/iu;
const date =
  /\b(?:fecha|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|ma[nñ]ana|hoy|ayer|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/iu;
const courtesy =
  /^(?:(?:hola|buenos dias|buenas tardes|buenas noches|hello|hi)|(?:muchas )?gracias(?: (?:por (?:tu|su|el) (?:mensaje|correo|consulta)|y (?:un )?saludo))?|thanks(?: for your (?:message|email))?|thank you(?: for your (?:message|email))?|(?:un |cordiales? )?saludos?|atentamente|(?:best|kind) regards|regards|confirmo que he recibido (?:tu|su|el|este) (?:mensaje|correo)|he recibido (?:tu|su|el|este) (?:mensaje|correo)|i (?:confirm that i )?(?:have received|received) (?:your|this) (?:message|email)|receipt confirmed)[.!]*$/u;
const isCourtesy = (text: string) =>
  courtesy.test(normalize(text).replace(/[,!:.]+$/u, '')) ||
  courtesy.test(
    normalize(text)
      .replace(/^(?:hola|hello|hi),\s*/u, '')
      .replace(/[,!:.]+$/u, ''),
  );
const restrictions: [string, RegExp][] = [
  ['NEGATION', /\b(?:no|not|never|nunca|sin|without)\b/u],
  [
    'TAX_INCLUDED',
    /\b(?:iva|impuestos?|tax(?:es)?)\s+(?:incluid\w*|included)\b/u,
  ],
  [
    'TAX_EXCLUDED',
    /\b(?:iva|impuestos?|tax(?:es)?)\s+(?:excluid\w*|excluded|no incluid\w*)\b|\b(?:sin iva|sin impuestos|mas iva|plus tax|excluding tax)\b/u,
  ],
  [
    'MINIMUM',
    /\b(?:desde|a partir de|minimo|at least|starting (?:at|from)|from)\b/u,
  ],
  ['MAXIMUM', /\b(?:hasta|maximo|up to|at most)\b/u],
  [
    'CONDITIONAL',
    /\b(?:solo si|solamente si|siempre que|sujeto a|si|only if|subject to|provided that|if)\b/u,
  ],
  ['EXCEPTION', /\b(?:excepto|salvo|except|unless)\b/u],
  ['BEFORE', /\b(?:antes|before)\b/u],
  ['AFTER', /\b(?:despues|after)\b/u],
  ['BUSINESS_DAYS', /\b(?:laborables|habiles|business days|working days)\b/u],
  ['CALENDAR_DAYS', /\b(?:naturales|calendar days)\b/u],
  ['MONTHLY', /\b(?:mensual|mensuales|al mes|por mes|monthly|per month)\b/u],
  ['YEARLY', /\b(?:anual|anuales|al ano|por ano|annual|yearly|per year)\b/u],
  ['PER_PERSON', /\b(?:por persona|per person)\b/u],
  ['PER_UNIT', /\b(?:por unidad|per unit)\b/u],
  [
    'REQUIREMENT',
    /\b(?:requiere|requieren|debe|deben|necesario|previo|requires?|must|required)\b/u,
  ],
];
const conditions = (text: string) =>
  new Set(
    restrictions
      .filter(([, pattern]) => pattern.test(normalize(text)))
      .map(([name]) => name),
  );
function kind(text: string): (typeof factualKinds)[number] {
  if (commitment.test(normalize(text))) return 'COMMITMENT';
  if (money.test(normalize(text))) return 'AMOUNT';
  if (date.test(normalize(text))) return 'DATE';
  if (values(text).size) return 'QUANTITY';
  if (conditions(text).size) return 'CONDITION';
  return 'FACT';
}
function passages(text: string) {
  const result: { text: string; start: number; end: number }[] = [];
  const regex = /[^\n;]+?(?:[.!?](?=\s|$)|(?=[\n;]|$))/gu;
  for (const m of text.matchAll(regex)) {
    const trimmed = m[0].trim();
    if (trimmed) {
      const start = m.index + m[0].indexOf(trimmed);
      // Separate coordinated assertions so a broad citation cannot swap values
      // between two products within the same sentence.
      const separator =
        /,\s+(?=[\p{L}][^,;.!?\n]{0,80}\s+(?:es|son|cuesta|cuestan|is|are|costs)\b)|\s+(?:y|and|mientras que|whereas)\s+(?=[^,;.!?\n]{0,100}(?:\bes\b|\bson\b|\bcuesta\b|\bcosts\b|:))/giu;
      let offset = 0;
      for (const boundary of trimmed.matchAll(separator)) {
        const part = trimmed.slice(offset, boundary.index).trim();
        if (part) {
          const from = start + offset + trimmed.slice(offset).indexOf(part);
          result.push({ text: part, start: from, end: from + part.length });
        }
        offset = boundary.index + boundary[0].length;
      }
      const part = trimmed.slice(offset).trim();
      if (part) {
        const from = start + offset + trimmed.slice(offset).indexOf(part);
        result.push({ text: part, start: from, end: from + part.length });
      }
    }
  }
  return result;
}
const generic = new Set(
  'a al de del el la los las un una unos unas y o en para por que es son hay se tu tus su sus con the a an and or is are for of to your our we i it its this that el precio tarifa coste costo importe price pricing cost rate plazo entrega deadline servicio service es de son de is are cuesta cuestan costs sera seran will be el plan paquete producto product incluye incluyen include includes tiene have has permite allow allows disponible available horario hours hola gracias consulta thank thanks you hello hi saludo dias buenos buenas confirmo recibido mensaje correo'.split(
    ' ',
  ),
);
for (const word of [
  'indicado',
  'indicada',
  'indicados',
  'indicadas',
  'mentioned',
  'stated',
])
  generic.add(word);
function topicMatches(claim: string, quote: string) {
  const terms = (s: string) =>
    normalize(s)
      .replace(/\d+(?:[.,:/-]\d+)*/gu, ' ')
      .match(/\p{L}+/gu)
      ?.filter(
        (w) => w.length > 2 && !generic.has(w) && !words[w] && !units[w],
      ) ?? [];
  const source = terms(quote);
  const target = terms(claim);
  return target.every((term) =>
    source.some(
      (w) =>
        w === term ||
        (w.length >= 5 &&
          term.length >= 5 &&
          w.slice(0, 5) === term.slice(0, 5)),
    ),
  );
}
const substantive = (text: string) =>
  !isCourtesy(text) &&
  (values(text).size > 0 ||
    conditions(text).size > 0 ||
    commitment.test(normalize(text)) ||
    /\b(?:es|son|sera|seran|esta|estan|tiene|tienen|incluye|incluyen|cuesta|cuestan|dispone|disponemos|ofrece|permite|requiere|debe|deben|realiza|trabajamos|estamos|abre|abrimos|abierto|cerrado|acepta|aprobado|enviado|entregado|gratuit\w*|reembols\w*|is|are|has|have|includes|costs|requires|must|free|refundable|approved|shipped|delivered|open|closed)\b/u.test(
      normalize(text),
    ));

export function validateResponseFacts(
  input: GenerateReplyInput,
  response: GeneratedResponse &
    Pick<ResponseGenerationResult, 'knowledgeReferences'>,
): FactualValidation {
  const prepared = prepareGenerateReplyInput(input);
  const body = response.bodyText ?? '';
  const claims = passages(body)
    .filter(
      (p) =>
        substantive(p.text) ||
        response.evidence.some((e) =>
          normalize(p.text).includes(normalize(e.claim)),
        ),
    )
    .map((p) => ({ ...p, kind: kind(p.text) }));
  const issues: FactualAudit['issues'] = [];
  const missing: string[] = [];
  const add = (
    index: number,
    reason: (typeof factualReasons)[number],
    detail?: string,
  ) => {
    const claim = claims[index];
    if (
      !claim ||
      issues.some((i) => i.claimIndex === index && i.reason === reason) ||
      issues.length >= 32
    )
      return;
    issues.push({
      claimIndex: index,
      kind: claim.kind,
      reason,
      start: claim.start,
      end: claim.end,
    });
    if (missing.length < 8)
      missing.push(`${reason}: ${detail ?? claim.text}`.slice(0, 240));
  };
  const transform =
    /\b(?:resume|resumir|compara|corrige|traduce|summari[sz]e|translate|rewrite|compare)\b/u.test(
      normalize(input.conversation.messages.at(-1)!.text),
    );
  const evidenceOK = new Map<GeneratedResponse['evidence'][number], boolean>();
  for (const evidence of response.evidence) {
    const affected = claims
      .map((c, i) =>
        normalize(c.text).includes(normalize(evidence.claim)) ? i : -1,
      )
      .filter((i) => i >= 0);
    const message =
      'messageIndex' in evidence
        ? prepared.conversation.messages[evidence.messageIndex]
        : undefined;
    const fragment =
      'knowledgeIndex' in evidence
        ? prepared.knowledge[evidence.knowledgeIndex]
        : undefined;
    const source = fragment?.content ?? message?.text;
    let reason: (typeof factualReasons)[number] | undefined;
    const claimKind = kind(evidence.claim);
    if (
      !affected.length ||
      !source ||
      (fragment &&
        response.knowledgeReferences !== undefined &&
        !response.knowledgeReferences.some(
          (r) =>
            'knowledgeIndex' in evidence &&
            r.knowledgeIndex === evidence.knowledgeIndex &&
            r.sourceId === fragment.source_id &&
            r.documentId === fragment.document_id &&
            r.version === fragment.version &&
            r.chunkId === fragment.chunk_id,
        )) ||
      !literal(source).includes(literal(evidence.quote)) ||
      (message && !message.isTarget && !prepared.allowEmailHistory)
    )
      reason = 'INVALID_CITATION';
    else if (
      fragment &&
      !audienceMatchesAll(fragment, input.recipient, input.recipients)
    )
      reason = 'RECIPIENT_MISMATCH';
    else if (
      'messageIndex' in evidence &&
      evidence.messageIndex < (input.historicalContext?.length ?? 0) &&
      input.recipient &&
      !recipients(input).every(
        (address) =>
          input.historicalContext?.[
            evidence.messageIndex
          ].recipient?.toLowerCase() === address,
      ) &&
      substantive(evidence.claim)
    )
      reason = 'RECIPIENT_MISMATCH';
    else if (
      'messageIndex' in evidence &&
      evidence.messageIndex >= (input.historicalContext?.length ?? 0) &&
      recipients(input).length > 1 &&
      substantive(evidence.claim) &&
      !recipients(input).every((address) =>
        input.messageAudiences?.[
          evidence.messageIndex - (input.historicalContext?.length ?? 0)
        ]?.some((a) => a.toLowerCase() === address),
      )
    )
      reason = 'RECIPIENT_MISMATCH';
    else if (claimKind === 'COMMITMENT' && message?.speaker !== 'owner')
      reason = 'UNAUTHORIZED_COMMITMENT';
    else if (
      money.test(normalize(evidence.claim)) &&
      !transform &&
      (fragment
        ? knowledgeCurrency(fragment, prepared.knowledgeEvaluatedAt) !==
          'CURRENT'
        : message?.speaker !== 'owner' ||
          !prepared.allowEmailHistory ||
          prepared.evidenceSufficiency.requirements.some(
            (r) =>
              r.kind === 'PRICE' &&
              r.referenceIds.some((id) => !id.startsWith('message:')),
          ))
    )
      reason = 'SOURCE_NOT_CURRENT';
    else {
      // Bind each assertion to one passage, including restrictions surrounding
      // a short quote. Pooling values from unrelated products is not support.
      const sourcePassages = passages(source!);
      const supported = sourcePassages.filter(
        (p) =>
          normalize(p.text).includes(normalize(evidence.quote)) ||
          normalize(evidence.quote).includes(normalize(p.text)),
      );
      const candidates = supported
        .map((p) => {
          const next = sourcePassages[sourcePassages.indexOf(p) + 1];
          return next &&
            /^(?:solo|solamente|siempre que|excepto|salvo|sujeto|iva|impuestos|tax|only|except|unless|subject|provided|requires?|requiere|debe)\b/u.test(
              normalize(next.text),
            )
            ? { ...p, text: `${p.text} ${next.text}` }
            : p;
        })
        .filter(
          (p) =>
            !/[?¿]/u.test(p.text) || transform || !substantive(evidence.claim),
        );
      const wanted = values(evidence.claim);
      const byValue = candidates.filter(
        (p) =>
          [...wanted].every((v) => values(p.text).has(v)) &&
          (evidence.claim.match(/\d+(?:[.,:/-]\d+)*/gu) ?? []).every((v) =>
            p.text.includes(v),
          ),
      );
      const byTopic = byValue.filter(
        (p) =>
          topicMatches(evidence.claim, p.text) || !substantive(evidence.claim),
      );
      const byCondition = byTopic.filter((p) => {
        const a = conditions(evidence.claim),
          b = conditions(p.text);
        return a.size === b.size && [...a].every((v) => b.has(v));
      });
      const explicitRecipient = source!.match(
        /\b(?:cliente|destinatario|customer|recipient|para)\s*:\s*([^\s<>@]+@[^\s<>@]+\.[^\s<>@.,;]+)/iu,
      )?.[1];
      if (
        input.recipient &&
        explicitRecipient &&
        !recipients(input).every(
          (address) => explicitRecipient.toLowerCase() === address,
        )
      )
        reason = 'RECIPIENT_MISMATCH';
      else if (!byValue.length) reason = 'VALUE_MISMATCH';
      else if (!byTopic.length) reason = 'TOPIC_MISMATCH';
      else if (!byCondition.length) reason = 'CONDITION_MISMATCH';
    }
    evidenceOK.set(evidence, !reason);
    if (reason) affected.forEach((i) => add(i, reason));
    // A dangling citation must also fail closed, even with a courtesy body.
    if (reason && !affected.length) {
      const text = body || evidence.claim;
      claims.push({
        text,
        kind: claimKind,
        start: 0,
        end: Math.max(1, text.length),
      });
      add(claims.length - 1, reason);
    }
  }
  claims.forEach((claim, index) => {
    if (!substantive(claim.text)) return;
    if (invalidValue(claim.text)) add(index, 'INVALID_VALUE');
    if (
      !transform &&
      /\b(?:hoy|manana|ayer|today|tomorrow|yesterday)\b/u.test(
        normalize(claim.text),
      )
    )
      add(index, 'AMBIGUOUS_DATE');
    const citations = response.evidence.filter(
      (e) =>
        normalize(claim.text).includes(normalize(e.claim)) && evidenceOK.get(e),
    );
    if (!citations.length) {
      if (!issues.some((i) => i.claimIndex === index))
        add(
          index,
          commitment.test(normalize(claim.text))
            ? 'UNAUTHORIZED_COMMITMENT'
            : 'MISSING_EVIDENCE',
        );
      return;
    }
    const supported = new Set(citations.flatMap((e) => [...values(e.claim)]));
    const absent = [...values(claim.text)].filter((v) => !supported.has(v));
    if (absent.length)
      add(
        index,
        'MISSING_EVIDENCE',
        `${claim.text} (sin respaldo: ${absent.join(', ')})`,
      );
    if (!topicMatches(claim.text, citations.map((e) => e.claim).join(' ')))
      add(index, 'MISSING_EVIDENCE');
    if (
      commitment.test(normalize(claim.text)) &&
      !citations.some(
        (e) =>
          'messageIndex' in e &&
          prepared.conversation.messages[e.messageIndex]?.speaker === 'owner' &&
          commitment.test(normalize(e.claim)),
      )
    )
      add(index, 'UNAUTHORIZED_COMMITMENT');
  });
  const validation: FactualValidation = {
    version: factualValidationVersion,
    status: issues.length ? 'REVIEW_REQUIRED' : 'SUPPORTED',
    bodyHash: digest(body),
    contextHash: contextHash(input),
    recipientHash: recipientHash(input),
    evidenceHash: evidenceHash(response),
    claimCount: claims.length,
    issues,
    claims,
    missingInformation: missing,
  };
  seals.set(validation, fingerprint(factualAudit(validation)));
  return validation;
}

export function factualWarning(validation: FactualValidation): ResponseWarning {
  if (validation.issues.some((i) => i.reason === 'UNAUTHORIZED_COMMITMENT'))
    return 'UNSUPPORTED_COMMITMENT';
  if (
    validation.issues.some(
      (i) =>
        i.reason === 'INVALID_CITATION' || i.reason === 'SOURCE_NOT_CURRENT',
    )
  )
    return 'UNVERIFIED_EVIDENCE';
  return 'UNSUPPORTED_FACT';
}
export function rejectFactualValidation(
  validation: FactualValidation,
  reason: (typeof factualReasons)[number] = 'SEMANTIC_REJECTION',
): FactualValidation {
  const claims = validation.claims.length
    ? validation.claims
    : [
        {
          text: 'La propuesta requiere revisión factual.',
          kind: 'FACT' as const,
          start: 0,
          end: 1,
        },
      ];
  return {
    ...validation,
    status: 'REVIEW_REQUIRED',
    claims,
    claimCount: claims.length,
    issues: [
      ...validation.issues,
      {
        claimIndex: 0,
        kind: claims[0].kind,
        reason,
        start: claims[0].start,
        end: claims[0].end,
      },
    ].slice(0, 32),
    missingInformation: claims
      .slice(0, 8)
      .map((c) =>
        `Verificar el respaldo semántico de: ${c.text}`.slice(0, 240),
      ),
  };
}
export function applyFactualValidation(
  input: GenerateReplyInput,
  response: GenerateReplyResult,
): GenerateReplyResult {
  if (!response.bodyText) return response;
  const validation =
    response.factualValidation?.status === 'REVIEW_REQUIRED'
      ? response.factualValidation
      : validateResponseFacts(input, response);
  if (validation.status === 'SUPPORTED')
    return { ...response, factualValidation: validation };
  return finalizeReplyResult(
    {
      ...response,
      status: 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      evidence: [],
      sourcesUsed: [],
      knowledgeReferences: [],
      needsHumanInput: true,
      missingInformation: validation.missingInformation,
      warnings: [
        ...new Set<ResponseWarning>([
          ...response.warnings,
          factualWarning(validation),
          'HUMAN_REVIEW_REQUIRED',
        ]),
      ],
      factualValidation: validation,
    },
    input.conversation.subject,
    [],
  );
}

export function verifiedFactsAtWrite(
  input: GenerateReplyInput,
  response: Pick<
    GenerateReplyResult,
    | 'bodyText'
    | 'evidence'
    | 'factualValidation'
    | 'knowledgeReferences'
    | 'status'
    | 'language'
    | 'missingInformation'
    | 'warnings'
  >,
): FactualAudit | null {
  const validation = response.factualValidation;
  if (validation) {
    const {
      claims: _claims,
      missingInformation: _missing,
      ...audit
    } = validation;
    void _claims;
    void _missing;
    const parsed = factualAuditSchema.safeParse(audit);
    if (
      !parsed.success ||
      parsed.data.status !== 'SUPPORTED' ||
      seals.get(validation) !== fingerprint(parsed.data) ||
      parsed.data.bodyHash !== digest(response.bodyText) ||
      parsed.data.contextHash !== contextHash(input) ||
      parsed.data.recipientHash !== recipientHash(input) ||
      parsed.data.evidenceHash !== evidenceHash(response)
    )
      return null;
    return parsed.data;
  }
  // Legacy callers may produce a plain receipt acknowledgement. Any assertion
  // requiring source material must go through the generation validator.
  const checked = validateResponseFacts(input, response);
  return checked.status === 'SUPPORTED' &&
    !checked.claimCount &&
    passages(response.bodyText ?? '').every((p) => isCourtesy(p.text)) &&
    !response.evidence.length
    ? factualAudit(checked)
    : null;
}
