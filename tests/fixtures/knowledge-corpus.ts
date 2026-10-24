import type { KnowledgeRetrievalInput } from '@/modules/knowledge/retriever';
import type { KnowledgeConflict } from '@/modules/knowledge/provenance';
import type { DocumentValidity } from '@/modules/knowledge/documents';
import { textPdf, wordDocx } from './documents';

export const corpusVersion = 'mail042-v2';
export const corpusSources = {
  current: 10,
  archive: 20,
  manual: 10,
  fallback: 30,
  authority: 0,
  advisory: 100,
  disputed: 10,
  forbidden: 0,
} as const;
export type CorpusSource = keyof typeof corpusSources;
export const corpusDocuments = [
  {
    key: 'atlas-current',
    source: 'current',
    format: 'txt',
    version: 2,
    text: 'Precio de Atlas: 125 euros.',
    previousText: 'Precio de Atlas: 90 euros. Clave AntiguaAtlas.',
    validity: { validFrom: '2000-01-01', validUntil: null },
  },
  {
    key: 'atlas-archive',
    source: 'archive',
    format: 'pdf',
    version: 1,
    text: 'Precio de Atlas: 99 euros.',
    validity: { validFrom: null, validUntil: '2000-01-01' },
  },
  {
    key: 'support-manual',
    source: 'manual',
    format: 'docx',
    version: 1,
    text: 'Procedimiento de soporte: primero enviar el formulario de incidencia al equipo. Horario de soporte: lunes a viernes de 09:00 a 17:00.',
    validity: { validFrom: null, validUntil: null },
  },
  {
    key: 'nimbo-fallback',
    source: 'fallback',
    format: 'txt',
    version: 1,
    text: 'Plazo de Nimbo: siete días.',
    validity: { validFrom: null, validUntil: null },
  },
  {
    key: 'orion-authority',
    source: 'authority',
    format: 'txt',
    version: 1,
    text: 'Precio de Orion: 250 euros.',
    validity: { validFrom: '2000-01-01', validUntil: null },
  },
  {
    key: 'orion-advisory',
    source: 'advisory',
    format: 'txt',
    version: 1,
    text: 'Precio de Orion: 300 euros.',
    validity: { validFrom: '2000-01-01', validUntil: null },
  },
  {
    key: 'vega-left',
    source: 'disputed',
    format: 'txt',
    version: 1,
    text: 'Precio de Vega: 40 euros.',
    validity: { validFrom: '2000-01-01', validUntil: null },
  },
  {
    key: 'vega-right',
    source: 'disputed',
    format: 'txt',
    version: 1,
    text: 'Precio de Vega: 45 euros.',
    validity: { validFrom: '2000-01-01', validUntil: null },
  },
  {
    key: 'forbidden',
    source: 'forbidden',
    format: 'txt',
    version: 1,
    text: 'Precio de Atlas: 1 euros. Código de Nebula: CANARIOEXCLUIDO.',
    validity: { validFrom: '2000-01-01', validUntil: null },
  },
  {
    key: 'unassigned',
    source: null,
    format: 'txt',
    version: 1,
    text: 'Código de Quasar: CANARIOSINASIGNAR.',
    validity: { validFrom: null, validUntil: null },
  },
] as const satisfies readonly {
  key: string;
  source: CorpusSource | null;
  format: 'txt' | 'pdf' | 'docx';
  text: string;
  previousText?: string;
  version: number;
  validity: DocumentValidity;
}[];
export type CorpusDocument = (typeof corpusDocuments)[number]['key'];

export async function corpusFile(
  document: (typeof corpusDocuments)[number],
  previous = false,
) {
  const text =
    previous && 'previousText' in document
      ? document.previousText
      : document.text;
  if (document.format === 'pdf')
    return new File([new Uint8Array(textPdf(text))], `${document.key}.pdf`, {
      type: 'application/pdf',
    });
  if (document.format === 'docx') {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>GUÍA DE SOPORTE</w:t></w:r></w:p><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>ANEXO</w:t></w:r></w:p><w:p><w:r><w:t>${'Material auxiliar para las personas del equipo. '.repeat(180)}</w:t></w:r></w:p></w:body></w:document>`;
    return new File(
      [new Uint8Array(await wordDocx({ 'word/document.xml': xml }))],
      `${document.key}.docx`,
      {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    );
  }
  return new File([text], `${document.key}.txt`, { type: 'text/plain' });
}

export const corpusRules: {
  title: string;
  terms: string[];
  primary: CorpusSource[];
  fallback?: CorpusSource[];
}[] = [
  { title: 'Atlas', terms: ['atlas'], primary: ['current', 'archive'] },
  { title: 'Soporte', terms: ['soporte'], primary: ['manual'] },
  {
    title: 'Respaldo de Nimbo',
    terms: ['nimbo'],
    primary: ['current'],
    fallback: ['fallback'],
  },
  {
    title: 'Autoridad de Orion',
    terms: ['orion'],
    primary: ['advisory', 'authority'],
  },
  { title: 'Contradicciones de Vega', terms: ['vega'], primary: ['disputed'] },
  {
    title: 'Consultas sin evidencia',
    terms: ['zafiro', 'nebula', 'quasar', 'halley'],
    primary: ['current'],
  },
];

type Evidence = { document: CorpusDocument; quote: string; version: number };
export type CorpusCase = {
  id: string;
  category:
    | 'literal'
    | 'authority'
    | 'conflict'
    | 'no-answer'
    | 'permissions'
    | 'partial';
  question: string;
  intent?: KnowledgeRetrievalInput['intent'];
  evidence: Evidence[];
  returnedDocuments: CorpusDocument[];
  disposition: 'ANSWERABLE' | 'HUMAN_INPUT';
  policy: 'ALLOW_DRAFT' | 'REVIEW_REQUIRED';
  fallback: boolean;
  resolution?: KnowledgeConflict['resolution'];
  missingKind?: string;
};
const evidence = (key: CorpusDocument, quote?: string): Evidence => {
  const doc = corpusDocuments.find((d) => d.key === key)!;
  return { document: key, quote: quote ?? doc.text, version: doc.version };
};
const answer = (
  id: string,
  question: string,
  document: CorpusDocument,
  extra: Partial<CorpusCase> = {},
): CorpusCase => ({
  id,
  category: 'literal',
  question,
  evidence: [evidence(document)],
  returnedDocuments: [document],
  disposition: 'ANSWERABLE',
  policy: 'ALLOW_DRAFT',
  fallback: false,
  ...extra,
});
const missing = (
  id: string,
  question: string,
  extra: Partial<CorpusCase> = {},
): CorpusCase => ({
  id,
  category: 'no-answer',
  question,
  evidence: [],
  returnedDocuments: [],
  disposition: 'HUMAN_INPUT',
  policy: 'ALLOW_DRAFT',
  fallback: false,
  ...extra,
});
export const corpusCases: CorpusCase[] = [
  answer(
    'atlas-current-version',
    '¿Cuál es el precio de Atlas?',
    'atlas-current',
  ),
  answer(
    'atlas-case-and-accents',
    '¿Cuál es el PRECIO de Átlas?',
    'atlas-current',
  ),
  answer(
    'atlas-plural-prices',
    '¿Cuáles son las tarifas de Atlas?',
    'atlas-current',
  ),
  answer(
    'support-procedure',
    '¿Cuál es el procedimiento de soporte?',
    'support-manual',
  ),
  answer('support-hours', '¿Cuál es el horario de soporte?', 'support-manual'),
  answer('nimbo-fallback', '¿Cuál es el plazo de Nimbo?', 'nimbo-fallback', {
    fallback: true,
  }),
  answer(
    'orion-source-authority',
    '¿Cuál es el precio de Orion?',
    'orion-authority',
    { category: 'authority', resolution: 'PREFER_AUTHORITY' },
  ),
  {
    id: 'vega-unresolved',
    category: 'conflict',
    question: '¿Cuál es el precio de Vega?',
    evidence: [evidence('vega-left'), evidence('vega-right')],
    returnedDocuments: ['vega-left', 'vega-right'],
    disposition: 'HUMAN_INPUT',
    policy: 'REVIEW_REQUIRED',
    fallback: false,
    resolution: 'UNRESOLVED',
  },
  missing('absent-answer', '¿Cuál es el código de Zafiro?'),
  missing('irrelevant-price-is-not-evidence', '¿Cuál es el precio de Zafiro?', {
    missingKind: 'PRICE',
  }),
  missing('forbidden-source', '¿Cuál es el código de Nebula?', {
    category: 'permissions',
  }),
  missing('unassigned-document', '¿Cuál es el código de Quasar?', {
    category: 'permissions',
  }),
  missing('other-owner', '¿Cuál es el código de Halley?', {
    category: 'permissions',
  }),
  missing('wrong-intent', '¿Cuál es el precio de Atlas?', {
    category: 'permissions',
    intent: 'MEETING',
  }),
  missing(
    'partial-known-price-missing-deadline',
    '¿Cuál es el precio de Atlas? ¿Cuál es el plazo de Atlas?',
    {
      category: 'partial',
      evidence: [evidence('atlas-current')],
      returnedDocuments: ['atlas-current'],
      missingKind: 'DEADLINE',
    },
  ),
];
