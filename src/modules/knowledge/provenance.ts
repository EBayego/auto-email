import type { KnowledgeFragment } from './retriever';
import { normalizeSourceTopic } from '@/modules/source-router/route-sources';

export type KnowledgeCurrency =
  'CURRENT' | 'EXPIRED' | 'NOT_YET_VALID' | 'UNSPECIFIED';
export type KnowledgeReference = Pick<
  KnowledgeFragment,
  | 'source_id'
  | 'source_title'
  | 'source_priority'
  | 'document_id'
  | 'document_name'
  | 'version'
  | 'chunk_id'
  | 'section'
  | 'page_start'
  | 'page_end'
  | 'start_offset'
  | 'end_offset'
  | 'document_updated_at'
  | 'valid_from'
  | 'valid_until'
> & {
  reference_id: string;
  currency: KnowledgeCurrency;
};
export type KnowledgeConflict = {
  fact: string;
  left: { reference_id: string; quote: string };
  right: { reference_id: string; quote: string };
  resolution: 'PREFER_CURRENT' | 'PREFER_AUTHORITY' | 'UNRESOLVED';
  preferred_reference_id: string | null;
};
export type KnowledgeReview = {
  evaluated_at: string;
  references: KnowledgeReference[];
  conflicts: KnowledgeConflict[];
  omitted: {
    reference_id: string;
    reason: 'EXPIRED' | 'NOT_YET_VALID' | 'CONFLICTING_VALUE';
  }[];
  incomplete: boolean;
};
export function knowledgeReferenceId(
  fragment: Pick<KnowledgeFragment, 'document_id' | 'version' | 'chunk_id'>,
) {
  return `${fragment.document_id}:v${fragment.version}:${fragment.chunk_id}`;
}
export function knowledgeCurrency(
  fragment: Pick<KnowledgeFragment, 'valid_from' | 'valid_until'>,
  date: string,
): KnowledgeCurrency {
  if (fragment.valid_from && fragment.valid_from > date) return 'NOT_YET_VALID';
  if (fragment.valid_until && fragment.valid_until < date) return 'EXPIRED';
  return fragment.valid_from || fragment.valid_until
    ? 'CURRENT'
    : 'UNSPECIFIED';
}
export function knowledgeReference(
  fragment: KnowledgeFragment,
  date: string,
): KnowledgeReference {
  const { content: _content, position: _position, ...fields } = fragment;
  void _content;
  void _position;
  return {
    ...fields,
    reference_id: knowledgeReferenceId(fragment),
    currency: knowledgeCurrency(fragment, date),
  };
}

// Only compare explicit, equally labelled assertions. Dates of ingestion and
// independent document version numbers never establish factual supersession.
function facts(text: string) {
  const values = new Map<string, { value: string; quote: string }>();
  const numbers: Record<string, string> = {
    uno: '1',
    un: '1',
    una: '1',
    dos: '2',
    tres: '3',
    cuatro: '4',
    cinco: '5',
    seis: '6',
    siete: '7',
    ocho: '8',
    nueve: '9',
    diez: '10',
    once: '11',
    doce: '12',
    trece: '13',
    catorce: '14',
    quince: '15',
    veinte: '20',
    treinta: '30',
  };
  for (const part of text
    .split(/\n|(?<=[.!?;])\s+(?=[\p{Lu}¿¡])/u)
    .slice(0, 40)) {
    const quote = part.trim();
    if (!quote || quote.length > 400) continue;
    const pair = quote.match(
      /^(.{3,120}?)(?:\s*:\s*|\s*=\s*|\s+(?:es de|son de|es|son|cuesta|cuestan|is|are|costs)\s+)(.{1,200})$/iu,
    );
    if (pair) {
      const key = normalizeSourceTopic(pair[1])
        .replace(
          /\b(?:el|la|los|las|the|vigente|actual|antigua|antiguo|anterior|current|old)\b/gu,
          '',
        )
        .replace(/\s+/gu, ' ')
        .trim();
      let value = pair[2]
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[.;]+$/u, '');
      value = value.replace(/[+-]?\d(?:[\d.,]*\d)?/gu, (s) => {
        let normalized: string;
        if (s.includes('.') && s.includes(',')) {
          const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
          normalized = s
            .replaceAll(decimal === '.' ? ',' : '.', '')
            .replace(decimal, '.');
        } else if (/^[+-]?\d{1,3}(?:[.,]\d{3})+$/u.test(s)) {
          normalized = s.replace(/[.,]/gu, '');
        } else normalized = s.replace(',', '.');
        return Number.isFinite(Number(normalized))
          ? String(Number(normalized))
          : s;
      });
      value = value
        .replace(/\b(?:euros?|eur)\b|€/gu, ' eur ')
        .replace(/\b(?:dólares?|dollars?|usd)\b|\$/gu, ' usd ')
        .replace(/\b(?:días?|days?)\b/gu, ' dia ')
        .replace(/\b(?:horas?|hours?)\b/gu, ' hora ')
        .replace(
          /\b(?:uno|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta)\b/gu,
          (s) => numbers[s],
        );
      if (key.length >= 3 && /\d/u.test(value))
        values.set(key, { value: value.replace(/\s+/gu, ' ').trim(), quote });
    }
    const statement = normalizeSourceTopic(quote);
    const negation = statement.match(
      /^(no )?((?:se permite|se permiten|se admite|se admiten|se acepta|se aceptan) .{3,100})$/u,
    );
    if (negation)
      values.set(negation[2], { value: negation[1] ? 'NO' : 'YES', quote });
    if (values.size >= 12) break;
  }
  return values;
}

export function reviewKnowledge(
  fragments: readonly KnowledgeFragment[],
  now: Date = new Date(),
): KnowledgeReview {
  const evaluated_at = now.toISOString();
  const date = evaluated_at.slice(0, 10);
  const references = fragments.map((f) => knowledgeReference(f, date));
  const omitted: KnowledgeReview['omitted'] = references.flatMap((r) =>
    r.currency === 'EXPIRED' || r.currency === 'NOT_YET_VALID'
      ? [{ reference_id: r.reference_id, reason: r.currency }]
      : [],
  );
  const conflicts: KnowledgeConflict[] = [];
  const assertions = fragments.map((f) => facts(f.content));
  for (let i = 0; i < fragments.length; i++) {
    for (let j = i + 1; j < fragments.length; j++) {
      const left = references[i],
        right = references[j];
      if (
        left.document_id === right.document_id ||
        ['EXPIRED', 'NOT_YET_VALID'].includes(left.currency) ||
        ['EXPIRED', 'NOT_YET_VALID'].includes(right.currency)
      )
        continue;
      for (const [fact, a] of assertions[i]) {
        const b = assertions[j].get(fact);
        if (!b || a.value === b.value) continue;
        if (conflicts.length >= 64)
          return {
            evaluated_at,
            references,
            conflicts,
            omitted,
            incomplete: true,
          };
        let preferred: KnowledgeReference | null = null;
        let resolution: KnowledgeConflict['resolution'] = 'UNRESOLVED';
        if (
          left.currency !== right.currency &&
          (left.currency === 'CURRENT' || right.currency === 'CURRENT')
        ) {
          preferred = left.currency === 'CURRENT' ? left : right;
          resolution = 'PREFER_CURRENT';
        } else if (left.source_priority !== right.source_priority) {
          preferred =
            left.source_priority < right.source_priority ? left : right;
          resolution = 'PREFER_AUTHORITY';
        }
        conflicts.push({
          fact,
          left: { reference_id: left.reference_id, quote: a.quote },
          right: { reference_id: right.reference_id, quote: b.quote },
          resolution,
          preferred_reference_id: preferred?.reference_id ?? null,
        });
        if (preferred)
          omitted.push({
            reference_id:
              preferred.reference_id === left.reference_id
                ? right.reference_id
                : left.reference_id,
            reason: 'CONFLICTING_VALUE',
          });
      }
    }
  }
  return {
    evaluated_at,
    references,
    conflicts,
    omitted: [...new Map(omitted.map((o) => [o.reference_id, o])).values()],
    incomplete: false,
  };
}
