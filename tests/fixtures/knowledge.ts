import type {
  KnowledgeCandidate,
  KnowledgeFragment,
} from '@/modules/knowledge/retriever';
import type { SourceConfiguration } from '@/modules/source-router/sources';

export const knowledgeId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function knowledgeConfiguration(): SourceConfiguration {
  return {
    revision: 'revision-39',
    allowPartialDrafts: false,
    sources: [1, 2, 3, 4].map((n) => ({
      id: knowledgeId(n),
      title: `Fuente ${n}`,
      priority: n,
      enabled: true,
    })),
    rules: [
      {
        id: knowledgeId(10),
        title: 'Información',
        intent: 'REQUEST_INFORMATION',
        terms: [],
        priority: 0,
        enabled: true,
        allowEmailHistory: false,
        primarySourceIds: [knowledgeId(1), knowledgeId(2)],
        fallbackSourceIds: [knowledgeId(3)],
        excludedSourceIds: [knowledgeId(4)],
      },
    ],
  };
}
export function knowledgeCandidate(
  n = 1,
  extra: Partial<KnowledgeCandidate> = {},
): KnowledgeCandidate {
  const content = 'El plazo de entrega es de siete días.';
  return {
    source_id: knowledgeId(1),
    source_title: 'Fuente 1',
    chunk_id: knowledgeId(n + 100),
    document_id: knowledgeId(n + 200),
    document_name: 'Procedimiento.txt',
    version: 1,
    document_updated_at: '2026-01-01T00:00:00.000Z',
    valid_from: null,
    valid_until: null,
    position: 0,
    section: '',
    content,
    start_offset: 0,
    end_offset: Array.from(content).length,
    page_start: null,
    page_end: null,
    rank: 0.1,
    ...extra,
  };
}
export function knowledgeFragment(
  extra: Partial<KnowledgeFragment> = {},
): KnowledgeFragment {
  const { rank: _rank, ...fragment } = knowledgeCandidate();
  void _rank;
  return { ...fragment, source_priority: 1, ...extra };
}
