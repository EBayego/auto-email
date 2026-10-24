import { describe, expect, it, vi } from 'vitest';
import {
  createKnowledgeRetriever,
  knowledgeTokenUpperBound,
} from './retriever';
import {
  knowledgeCandidate,
  knowledgeConfiguration,
  knowledgeFragment,
  knowledgeId,
} from '../../../tests/fixtures/knowledge';
import type { KnowledgeCandidate } from './retriever';
import { routeSources } from '@/modules/source-router/route-sources';

const question = {
  question: 'Hola, ¿cuál es el plazo de entrega? Gracias.',
  intent: 'REQUEST_INFORMATION' as const,
};
function setup(candidates: KnowledgeCandidate[] = [knowledgeCandidate()]) {
  const deps = {
    configuration: vi.fn(async () => knowledgeConfiguration()),
    search: vi
      .fn<Parameters<typeof createKnowledgeRetriever>[0]['search']>()
      .mockResolvedValue(candidates),
    assertRevision: vi
      .fn<Parameters<typeof createKnowledgeRetriever>[0]['assertRevision']>()
      .mockResolvedValue(undefined),
    now: () => new Date('2026-10-23T12:00:00Z'),
  };
  return { deps, retriever: createKnowledgeRetriever(deps) };
}
describe('MAIL-039 KnowledgeRetriever', () => {
  it('MAIL-044 comprueba el plan del orquestador antes de consultar una fuente', async () => {
    const { deps, retriever } = setup();
    const plan = routeSources(knowledgeConfiguration(), {
      query: question.question,
      intent: question.intent,
      topics: [],
    });
    plan.allowEmailHistory = true;
    await expect(retriever.retrieve(question, plan)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(deps.search).not.toHaveBeenCalled();
  });
  it('EPIC-06 reserva el único fragmento disponible para la evidencia útil del respaldo', async () => {
    const { deps, retriever } = setup();
    deps.search
      .mockResolvedValueOnce([
        knowledgeCandidate(1, {
          content: 'Precio de Atlas: pendiente de publicar.',
        }),
      ])
      .mockResolvedValueOnce([
        knowledgeCandidate(2, {
          source_id: knowledgeId(3),
          content: 'Precio de Atlas: 125 euros.',
          valid_from: '2000-01-01',
        }),
      ]);
    const result = await retriever.retrieve({
      ...question,
      question: '¿Cuál es el precio de Atlas?',
      maxFragments: 1,
    });
    expect(result.matches.map((f) => f.source_id)).toEqual([knowledgeId(3)]);
    expect(result.sufficiency.status).toBe('EVIDENCE_AVAILABLE');
    expect(result.truncated).toBe(true);
  });
  it('EPIC-06 detecta conflictos entre la evidencia principal y la que aporta el respaldo', async () => {
    const { deps, retriever } = setup();
    const config = knowledgeConfiguration();
    config.sources[2].priority = 1;
    deps.configuration.mockResolvedValue(config);
    deps.search
      .mockResolvedValueOnce([
        knowledgeCandidate(1, {
          content: 'Plazo de Atlas: siete días.',
          valid_from: '2000-01-01',
        }),
      ])
      .mockResolvedValueOnce([
        knowledgeCandidate(2, {
          source_id: knowledgeId(3),
          content: 'Precio de Atlas: 125 euros. Plazo de Atlas: diez días.',
          valid_from: '2000-01-01',
        }),
      ]);
    const result = await retriever.retrieve({
      ...question,
      question: '¿Cuál es el precio de Atlas? ¿Cuál es el plazo de Atlas?',
    });
    expect(result.usedFallback).toBe(true);
    expect(result.review.conflicts).toContainEqual(
      expect.objectContaining({ resolution: 'UNRESOLVED' }),
    );
    expect(result.policy.action).toBe('REVIEW_REQUIRED');
  });
  it('EPIC-06 consulta respaldo cuando la principal coincide pero no aporta el dato solicitado', async () => {
    const { deps, retriever } = setup();
    deps.search
      .mockResolvedValueOnce([
        knowledgeCandidate(1, {
          content: 'Precio de Atlas: pendiente de publicar.',
        }),
      ])
      .mockResolvedValueOnce([
        knowledgeCandidate(2, {
          source_id: knowledgeId(3),
          content: 'Precio de Atlas: 125 euros.',
          valid_from: '2000-01-01',
        }),
      ]);
    const result = await retriever.retrieve({
      ...question,
      question: '¿Cuál es el precio de Atlas?',
    });
    expect(result.usedFallback).toBe(true);
    expect(result.sufficiency.status).toBe('EVIDENCE_AVAILABLE');
    expect(result.matches).toContainEqual(
      expect.objectContaining({ source_id: knowledgeId(3) }),
    );
  });
  it('EPIC-06 combina evidencia principal y de respaldo para cubrir preguntas distintas', async () => {
    const { deps, retriever } = setup();
    deps.search
      .mockResolvedValueOnce([
        knowledgeCandidate(1, {
          content: 'Precio de Atlas: 125 euros.',
          valid_from: '2000-01-01',
        }),
      ])
      .mockResolvedValueOnce([
        knowledgeCandidate(2, {
          source_id: knowledgeId(3),
          content: 'Plazo de Atlas: siete días.',
        }),
      ]);
    const result = await retriever.retrieve({
      ...question,
      question: '¿Cuál es el precio de Atlas? ¿Cuál es el plazo de Atlas?',
    });
    expect(result.usedFallback).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.sufficiency.status).toBe('EVIDENCE_AVAILABLE');
  });
  it('EPIC-06 elimina coincidencias de precio que pertenecen a otro producto', async () => {
    const { retriever } = setup([
      knowledgeCandidate(1, {
        content: 'Precio de Atlas: 125 euros.',
        valid_from: '2000-01-01',
      }),
    ]);
    const result = await retriever.retrieve({
      ...question,
      question: '¿Cuál es el precio de Zafiro?',
    });
    expect(result.matches).toEqual([]);
    expect(result.sufficiency.status).toBe('NEEDS_HUMAN_INPUT');
  });
  it('MAIL-040 no oculta un conflicto irresoluble al recortar el contexto a un fragmento', async () => {
    const { retriever } = setup([
      knowledgeCandidate(1, { content: 'Plazo: 7 días.' }),
      knowledgeCandidate(2, { content: 'Plazo: 10 días.' }),
    ]);
    const result = await retriever.retrieve({ ...question, maxFragments: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.review.conflicts[0].resolution).toBe('UNRESOLVED');
    expect(result.policy).toEqual({
      action: 'REVIEW_REQUIRED',
      reasons: ['KNOWLEDGE_CONFLICT'],
    });
  });
  it('MAIL-040 prefiere vigencia declarada e informa de la condición sin vigencia descartada', async () => {
    const { retriever } = setup([
      knowledgeCandidate(1, { content: 'Plazo: 7 días.', rank: 0.9 }),
      knowledgeCandidate(2, {
        content: 'Plazo: 10 días.',
        rank: 0.1,
        valid_from: '2026-01-01',
      }),
    ]);
    const result = await retriever.retrieve(question);
    expect(result.matches.map((m) => m.chunk_id)).toEqual([knowledgeId(102)]);
    expect(result.review.conflicts[0].resolution).toBe('PREFER_CURRENT');
    expect(result.policy.action).toBe('ALLOW_DRAFT');
  });
  it('MAIL-040 consulta respaldo cuando solo hay documentos principales caducados', async () => {
    const { deps, retriever } = setup();
    deps.search
      .mockResolvedValueOnce([
        knowledgeCandidate(1, { valid_until: '2025-12-31' }),
      ])
      .mockResolvedValueOnce([
        knowledgeCandidate(2, {
          source_id: knowledgeId(3),
          valid_from: '2026-01-01',
        }),
      ]);
    const result = await retriever.retrieve(question);
    expect(result.usedFallback).toBe(true);
    expect(result.matches.map((m) => m.source_id)).toEqual([knowledgeId(3)]);
    expect(result.review.omitted[0].reason).toBe('EXPIRED');
    expect(result.policy.action).toBe('ALLOW_DRAFT');
  });
  it('extrae términos de una pregunta y devuelve solo extractos trazables con autoridad', async () => {
    const { deps, retriever } = setup();
    const result = await retriever.retrieve(question);
    expect(deps.search).toHaveBeenCalledExactlyOnceWith({
      query: '"plazo" OR "entrega"',
      sourceIds: [knowledgeId(1), knowledgeId(2)],
      revision: 'revision-39',
      limit: 20,
    });
    expect(result).toMatchObject({
      matches: [knowledgeFragment()],
      usedFallback: false,
      truncated: false,
    });
    expect(result.tokenUpperBound).toBe(
      knowledgeTokenUpperBound(result.matches),
    );
    expect(deps.assertRevision).toHaveBeenCalledWith('revision-39');
  });
  it('la autorización explícita solo restringe las fuentes del router', async () => {
    const { deps, retriever } = setup([
      knowledgeCandidate(1, { source_id: knowledgeId(2) }),
    ]);
    const result = await retriever.retrieve({
      ...question,
      allowedSourceIds: [knowledgeId(2), knowledgeId(4), knowledgeId(99)],
    });
    expect(deps.search.mock.calls[0][0].sourceIds).toEqual([knowledgeId(2)]);
    expect(result.matches.map((m) => m.source_id)).toEqual([knowledgeId(2)]);
  });
  it.each([{ ids: [] }, { ids: [knowledgeId(4)] }, { ids: [knowledgeId(99)] }])(
    'no busca fuera de la autorización %j',
    async ({ ids: allowedSourceIds }) => {
      const { deps, retriever } = setup();
      const result = await retriever.retrieve({
        ...question,
        allowedSourceIds,
      });
      expect(result.matches).toEqual([]);
      expect(result.plan.reason).toBe('NO_AUTHORIZED_SOURCES');
      expect(deps.search).not.toHaveBeenCalled();
    },
  );
  it('sin regla aplicable o términos útiles no consulta el índice', async () => {
    const { deps, retriever } = setup();
    expect(
      (await retriever.retrieve({ ...question, intent: 'MEETING' })).matches,
    ).toEqual([]);
    expect(
      (await retriever.retrieve({ ...question, question: 'Hola y gracias' }))
        .matches,
    ).toEqual([]);
    expect(deps.search).not.toHaveBeenCalled();
  });
  it('combina relevancia y autoridad sin que una fuente con muchos resultados oculte las demás', async () => {
    const { retriever } = setup([
      knowledgeCandidate(1, { rank: 0.02 }),
      knowledgeCandidate(2, {
        source_id: knowledgeId(2),
        rank: 0.5,
        content: 'El plazo especial de entrega es de dos días.',
      }),
      knowledgeCandidate(3, {
        rank: 0.5,
        content: 'El plazo ordinario de entrega es de cinco días.',
      }),
    ]);
    expect(
      (await retriever.retrieve(question)).matches.map((m) => m.chunk_id),
    ).toEqual([knowledgeId(103), knowledgeId(102), knowledgeId(101)]);
  });
  it('elimina duplicados entre documentos, pero conserva afirmaciones con cifras diferentes', async () => {
    const { retriever } = setup([
      knowledgeCandidate(),
      knowledgeCandidate(2),
      knowledgeCandidate(3, {
        content: 'El plazo de entrega es de ocho días.',
      }),
    ]);
    expect((await retriever.retrieve(question)).matches).toHaveLength(2);
  });
  it('descarta fragmentos de fuentes excluidas, no solicitadas, sin relevancia o con metadatos inválidos', async () => {
    const { retriever } = setup([
      knowledgeCandidate(1, { source_id: knowledgeId(4) }),
      knowledgeCandidate(2, { source_id: knowledgeId(99) }),
      knowledgeCandidate(3, { content: 'Un texto sobre recetas de cocina.' }),
      knowledgeCandidate(4, { version: 0 }),
      knowledgeCandidate(5, { rank: 0 }),
      knowledgeCandidate(6, { rank: NaN }),
    ]);
    expect(
      (
        await retriever.retrieve({
          ...question,
          allowedSourceIds: [knowledgeId(1)],
        })
      ).matches,
    ).toEqual([]);
  });
  it('consulta respaldo después de filtrar los candidatos principales irrelevantes', async () => {
    const { deps, retriever } = setup();
    deps.search
      .mockResolvedValueOnce([
        knowledgeCandidate(1, { content: 'Recetas de cocina' }),
      ])
      .mockResolvedValueOnce([
        knowledgeCandidate(2, { source_id: knowledgeId(3) }),
      ]);
    const result = await retriever.retrieve(question);
    expect(result.usedFallback).toBe(true);
    expect(result.matches[0].source_id).toBe(knowledgeId(3));
    expect(deps.search.mock.calls[1][0].sourceIds).toEqual([knowledgeId(3)]);
  });
  it('no convierte un error de autorización o configuración en una búsqueda de respaldo', async () => {
    const { deps, retriever } = setup();
    deps.search.mockRejectedValue(new Error('SOURCE_CONFIGURATION_CHANGED'));
    await expect(retriever.retrieve(question)).rejects.toThrow(
      'SOURCE_CONFIGURATION_CHANGED',
    );
    expect(deps.search).toHaveBeenCalledTimes(1);
  });
  it('descarta todo el resultado si se modifican las reglas al terminar la búsqueda', async () => {
    const { deps, retriever } = setup();
    deps.assertRevision.mockRejectedValue(
      new Error('SOURCE_CONFIGURATION_CHANGED'),
    );
    await expect(retriever.retrieve(question)).rejects.toThrow(
      'SOURCE_CONFIGURATION_CHANGED',
    );
  });
  it('aplica un presupuesto conservador que incluye UTF-8 y metadatos sin cortar una cita', async () => {
    const small = knowledgeFragment();
    const { retriever } = setup([
      knowledgeCandidate(1, {
        content: 'Plazo de entrega: ' + '🙂'.repeat(800),
        rank: 1,
      }),
      knowledgeCandidate(2, { content: small.content }),
    ]);
    const budget = knowledgeTokenUpperBound([small]);
    const result = await retriever.retrieve({
      ...question,
      maxContextTokens: budget,
    });
    expect(result.matches.map((m) => m.chunk_id)).toEqual([knowledgeId(102)]);
    expect(result.tokenUpperBound).toBeLessThanOrEqual(budget);
    expect(result.truncated).toBe(true);
    expect(result.matches[0].content).toBe(small.content);
  });
  it('limita el número de fragmentos y no deduplica cifras contradictorias', async () => {
    const { retriever } = setup([
      knowledgeCandidate(),
      knowledgeCandidate(2, {
        content: 'El plazo de entrega es de tres días.',
      }),
    ]);
    const result = await retriever.retrieve({ ...question, maxFragments: 1 });
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
  it.each([
    { question: '' },
    { intent: 'INVALID' },
    { maxFragments: 9 },
    { maxContextTokens: 12001 },
    { allowedSourceIds: ['bad'] },
    { userId: knowledgeId(99) },
    { question: 'x'.repeat(12001) },
  ])('rechaza límites e identidad no válidos %j', async (extra) => {
    const { deps, retriever } = setup();
    await expect(
      retriever.retrieve({ ...question, ...extra } as typeof question),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(deps.configuration).not.toHaveBeenCalled();
  });
});
