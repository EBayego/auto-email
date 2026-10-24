import type { KnowledgeFragment } from './retriever';
import { knowledgeCurrency, knowledgeReferenceId } from './provenance';
import { normalizeSourceTopic } from '@/modules/source-router/route-sources';

export type EvidenceRequirementKind =
  | 'PRICE'
  | 'DEADLINE'
  | 'HOURS'
  | 'PROCEDURE'
  | 'CALENDAR'
  | 'ORDER_STATUS'
  | 'OWNER_DECISION'
  | 'ATTACHMENT'
  | 'FACT';
export type EvidenceRequirement = {
  kind: EvidenceRequirementKind;
  question: string;
  status: 'SUPPORTED' | 'MISSING';
  referenceIds: string[];
  reason:
    | 'EVIDENCE_FOUND'
    | 'NO_MATCHING_EVIDENCE'
    | 'UNVERIFIED_CURRENCY'
    | 'OWNER_INPUT_REQUIRED';
};
export type EvidenceSufficiency = {
  status: 'NOT_REQUIRED' | 'EVIDENCE_AVAILABLE' | 'NEEDS_HUMAN_INPUT';
  requirements: EvidenceRequirement[];
  missingInformation: string[];
  canPreparePartial: boolean;
};
const patterns: [EvidenceRequirementKind, RegExp, string][] = [
  [
    'PRICE',
    /\b(?:precios?|tarifas?|costes?|costos?|importes?|presupuestos?|cuesta|cuestan|cuanto vale|cobrais|prices?|pricing|costs?|rates?|how much)\b/u,
    'Tarifa o importe vigente para la consulta.',
  ],
  [
    'DEADLINE',
    /\b(?:plazos?|fechas? limite|deadlines?|turnaround|delivery date|how long|cuando (?:se )?(?:entrega|entregais|entregan))\b/u,
    'Plazo o fecha de entrega respaldados.',
  ],
  [
    'HOURS',
    /\b(?:horario|horarios|opening hours|business hours)\b/u,
    'Horario de atención respaldado.',
  ],
  [
    'PROCEDURE',
    /\b(?:procedimientos?|pasos|requisitos|documentacion|requirements|procedures?|process|policy)\b/u,
    'Procedimiento o requisitos documentados.',
  ],
  [
    'CALENDAR',
    /\b(?:disponibilidad|estas libre|estais libres|estas disponible|estais disponibles|are you available|calendar|agenda|reunirnos|quedamos|cita|meeting|appointment|availability)\b/u,
    'Disponibilidad confirmada por el titular; no hay acceso al calendario.',
  ],
  [
    'ORDER_STATUS',
    /\b(?:estado (?:de |del |de mi |de nuestro )?(?:pedido|orden|envio)|order status|tracking|seguimiento (?:de |del )?(?:pedido|envio))\b/u,
    'Estado del pedido o envío confirmado; no hay acceso al sistema de pedidos.',
  ],
  [
    'OWNER_DECISION',
    /\b(?:acepta[rs]? (?:la |el |esta )?(?:oferta|contrato)|confirm(?:as|ar|a) (?:la |una )?(?:reunion|reserva)|te comprometes|puedes comprometerte|darme un descuento|aplicar un descuento|accept (?:the |this )?(?:offer|contract)|confirm (?:the |a )?meeting)\b/u,
    'Decisión o compromiso autorizado expresamente por el titular.',
  ],
  [
    'ATTACHMENT',
    /\b(?:lee|leer|revisa|revisar|responde|contesta|segun|read|review|answer|based on)\b.*\b(?:adjunto|attached|attachment)\b|\b(?:adjunto|attached)\b.*\b(?:preguntas|contenido|questions|content)\b/u,
    'Contenido del adjunto verificado; los adjuntos entrantes no se leen automáticamente.',
  ],
];
const missingLabels = new Map(patterns.map(([kind, , label]) => [kind, label]));
const protectedKinds = new Set<EvidenceRequirementKind>([
  'CALENDAR',
  'ORDER_STATUS',
  'OWNER_DECISION',
  'ATTACHMENT',
]);
const generic = new Set(
  'a al de del el la los las un una unos unas y o en para por que cual cuales cuanto cuantos cuando como donde es son hay se me mi mis tu tus su sus nos os le les con sin sobre the a an and or what which how much many when is are for of to your our please por favor hola gracias podrias puedes puede podria quisiera quiero necesito saber dime indicame decir conocer actual actuales vigente vigentes precio precios tarifa tarifas coste costo importe presupuesto price pricing cost rate plazo plazos fecha limite entrega deadline horario horarios atencion opening hours business procedimiento pasos requisitos documentacion requirements procedure process policy servicio servicios informacion consulta confirmame explicame'.split(
    ' ',
  ),
);
const normalize = normalizeSourceTopic;
for (const word of 'hello hi thank thanks you can could would confirm that this team we provide podemos puedes proximo proxima estas estais estoy'.split(
  ' ',
))
  generic.add(word);
function declarative(text: string) {
  return text
    .replace(/[^.!?\n]*\?/gu, '')
    .replace(/¿/gu, '')
    .trim();
}
export function evidenceTopicMatches(question: string, text: string) {
  const topic = patterns.reduce(
    (value, [, pattern]) => value.replace(pattern, ' '),
    normalize(question),
  );
  const terms = [
    ...new Set(
      topic
        .split(' ')
        .filter((t) => (t.length > 2 || /^\d+$/u.test(t)) && !generic.has(t)),
    ),
  ].slice(0, 12);
  const words = normalize(text).split(' ');
  return (
    !terms.length ||
    terms.every((t) =>
      words.some(
        (w) =>
          w === t ||
          (t.length >= 5 && w.length >= 5 && w.slice(0, 5) === t.slice(0, 5)),
      ),
    )
  );
}
const quantity =
  '(?:\\d+(?:[.,]\\d+)*|uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)';
function hasAnswer(kind: EvidenceRequirementKind, text: string) {
  const body = normalize(text);
  switch (kind) {
    case 'PRICE':
      return (
        new RegExp(
          `(?:${quantity}\\s*(?:euros?|eur|usd|dolares?|libras?|pesos)|(?:eur|usd)\\s*${quantity})`,
          'u',
        ).test(body) || /\d[\d.,]*\s*[€$£]/u.test(text)
      );
    case 'DEADLINE':
      return (
        new RegExp(
          `${quantity}\\s+(?:dias?|horas?|semanas?|meses|days?|hours?|weeks?)`,
          'u',
        ).test(body) ||
        /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/u.test(text)
      );
    case 'HOURS':
      return (
        /\b\d{1,2}[:h]\d{2}\b/u.test(text) ||
        /\b(?:lunes|martes|miercoles|jueves|viernes|sabados?|domingos?|monday|tuesday|wednesday|thursday|friday)\b/u.test(
          body,
        )
      );
    case 'PROCEDURE':
      return /\b(?:debe|deben|requiere|requieren|presentar|enviar|entregar|rellenar|primero|paso|necesario|must|required|submit|step)\b/u.test(
        body,
      );
    case 'CALENDAR':
      return (
        /\b(?:disponible|disponibles|libre|available)\b/u.test(body) &&
        /\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday)\b|\d/u.test(
          body,
        )
      );
    case 'ORDER_STATUS':
      return /\b(?:enviado|entregado|pendiente|preparacion|transito|cancelado|shipped|delivered|pending|transit)\b/u.test(
        body,
      );
    case 'OWNER_DECISION':
      return /\b(?:acepto|aceptamos|confirmo|confirmamos|autorizo|autorizamos|agree|accept|confirm|authorize)\b/u.test(
        body,
      );
    case 'ATTACHMENT':
      return false;
    case 'FACT':
      return (
        text.length >= 25 &&
        !/^\s*(?:hola|gracias|hello|thanks)[.!]?\s*$/iu.test(text)
      );
  }
}
export function matchingAnswer(
  kind: EvidenceRequirementKind,
  question: string,
  body: string,
  section = '',
) {
  // A product name in one sentence does not make an unrelated amount in
  // another sentence evidence for that product. Section headings remain context.
  return body
    .split(/(?<=[.!?])\s+|[\n;]+|\s+(?:y|pero|and|but)\s+/iu)
    .some(
      (passage) =>
        evidenceTopicMatches(question, `${section} ${passage}`) &&
        hasAnswer(kind, passage),
    );
}
export function assessEvidence(input: {
  question: string;
  intent?: string;
  fragments: readonly KnowledgeFragment[];
  ownerMessages?: readonly { text: string; index: number }[];
  now?: Date;
}): EvidenceSufficiency {
  const question = normalize(input.question);
  // Transforming quoted/current-message data does not require outside facts.
  const selfContained =
    /\b(?:resume|resumir|compara|comparar|corrige|corregir|ordena|ordenar|traduce|traducir|summarize|translate|proofread)\b/u.test(
      question,
    ) &&
    /\b(?:este texto|este mensaje|este correo|siguiente texto|texto siguiente|datos presentes|this text|this message|following text)\b/u.test(
      question,
    );
  const clauses = input.question
    .split(
      /[?\n;]+|(?<=[.!])\s+(?=¿|(?:what|which|how|when|where)\b)|\s+y\s+(?=(?:cu[aá]l|qu[eé]|cu[aá]nto|cu[aá]ndo|c[oó]mo)\b)/iu,
    )
    .map((q) => q.trim())
    .filter(Boolean);
  const requested: { kind: EvidenceRequirementKind; question: string }[] = [];
  for (const clause of clauses) {
    const normalized = normalize(clause);
    if (
      selfContained &&
      /\b(?:resume|resumir|compara|comparar|corrige|corregir|traduce|traducir|summarize|translate)\b/u.test(
        normalized,
      )
    )
      continue;
    let matched = false;
    for (const [kind, pattern] of patterns)
      if (pattern.test(normalized)) {
        matched = true;
        requested.push({ kind, question: clause.slice(0, 300) });
      }
    if (
      !matched &&
      !selfContained &&
      /(?:^|\b)(?:cual|que|cuanto|cuando|como|donde|what|which|how|when|where|can you|could you)\b/u.test(
        normalized,
      ) &&
      !/\b(?:recibido|recepcion|received|receipt)\b/u.test(normalized)
    )
      requested.push({ kind: 'FACT', question: clause.slice(0, 300) });
  }
  if (
    !selfContained &&
    !requested.length &&
    (input.intent === 'REQUEST_INFORMATION' || /[?¿]/u.test(input.question)) &&
    !/\b(?:recibido|recepcion|received|receipt)\b/u.test(question)
  )
    requested.push({ kind: 'FACT', question: input.question.slice(0, 300) });
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);
  const requirements: EvidenceRequirement[] = requested
    .slice(0, 8)
    .map((requirement) => {
      const { kind } = requirement;
      const references: string[] = [];
      let unknownCurrency = false;
      if (kind !== 'ATTACHMENT')
        for (const message of input.ownerMessages ?? []) {
          const body = declarative(message.text);
          if (matchingAnswer(kind, requirement.question, body))
            references.push(`message:${message.index}`);
        }
      if (!protectedKinds.has(kind))
        for (const fragment of input.fragments) {
          const body = declarative(fragment.content);
          const currency = knowledgeCurrency(fragment, date);
          if (currency === 'EXPIRED' || currency === 'NOT_YET_VALID') continue;
          if (
            !matchingAnswer(kind, requirement.question, body, fragment.section)
          )
            continue;
          if (kind === 'PRICE' && currency !== 'CURRENT') {
            unknownCurrency = true;
            continue;
          }
          references.push(knowledgeReferenceId(fragment));
        }
      return {
        ...requirement,
        status: references.length ? 'SUPPORTED' : 'MISSING',
        referenceIds: references,
        reason: references.length
          ? 'EVIDENCE_FOUND'
          : protectedKinds.has(kind)
            ? 'OWNER_INPUT_REQUIRED'
            : unknownCurrency
              ? 'UNVERIFIED_CURRENCY'
              : 'NO_MATCHING_EVIDENCE',
      };
    });
  const missing = requirements.filter((r) => r.status === 'MISSING');
  const overflow = requested.length > 8;
  return {
    status: !requirements.length
      ? 'NOT_REQUIRED'
      : missing.length || overflow
        ? 'NEEDS_HUMAN_INPUT'
        : 'EVIDENCE_AVAILABLE',
    requirements,
    missingInformation: [
      ...missing.map(
        (r) =>
          missingLabels.get(r.kind) ??
          'Información factual autorizada para responder a la pregunta.',
      ),
      ...(overflow
        ? [
            'La consulta contiene demasiadas preguntas; requiere revisión completa del titular.',
          ]
        : []),
    ].slice(0, 8),
    canPreparePartial:
      missing.length > 0 &&
      !overflow &&
      requirements.some((r) => r.status === 'SUPPORTED') &&
      !requirements.some((r) => protectedKinds.has(r.kind)),
  };
}
export function claimsMissingEvidence(
  sufficiency: EvidenceSufficiency,
  body: string,
) {
  return sufficiency.requirements.some(
    (r) =>
      r.status === 'MISSING' &&
      !protectedKinds.has(r.kind) &&
      r.kind !== 'FACT' &&
      hasAnswer(r.kind, body),
  );
}
