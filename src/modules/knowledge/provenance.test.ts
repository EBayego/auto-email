import { describe, expect, it } from 'vitest';
import {
  knowledgeCurrency,
  knowledgeReferenceId,
  reviewKnowledge,
} from './provenance';
import { evaluateKnowledgePolicy } from '@/modules/policy/knowledge-policy';
import {
  knowledgeFragment,
  knowledgeId,
} from '../../../tests/fixtures/knowledge';
import type { KnowledgeFragment } from './retriever';
import { documentValiditySchema } from './documents';

const now = new Date('2026-10-23T12:00:00Z');
function pair(a: string, b: string, extra: Partial<KnowledgeFragment> = {}) {
  return [
    knowledgeFragment({ content: a }),
    knowledgeFragment({
      content: b,
      chunk_id: knowledgeId(102),
      document_id: knowledgeId(202),
      ...extra,
    }),
  ];
}
describe('MAIL-040 procedencia, vigencia y contradicciones', () => {
  it.each([
    [{ valid_from: null, valid_until: null }, 'UNSPECIFIED'],
    [{ valid_from: '2026-10-23', valid_until: '2026-10-23' }, 'CURRENT'],
    [{ valid_from: null, valid_until: '2026-10-23' }, 'CURRENT'],
    [{ valid_from: '2026-10-24', valid_until: null }, 'NOT_YET_VALID'],
    [{ valid_from: null, valid_until: '2026-10-22' }, 'EXPIRED'],
  ] as const)(
    'evalúa límites inclusivos sin inventar vigencia: %j',
    (period, expected) => {
      expect(knowledgeCurrency(period, '2026-10-23')).toBe(expected);
    },
  );
  it('conserva referencias estables sin incluir el contenido en los metadatos', () => {
    const fragment = knowledgeFragment();
    const review = reviewKnowledge([fragment], now);
    expect(review.references[0]).toMatchObject({
      reference_id: knowledgeReferenceId(fragment),
      document_name: fragment.document_name,
      version: 1,
      document_updated_at: fragment.document_updated_at,
      currency: 'UNSPECIFIED',
    });
    expect(review.references[0]).not.toHaveProperty('content');
    const reindexed = {
      ...fragment,
      document_updated_at: '2026-10-23T00:00:00Z',
    };
    expect(knowledgeReferenceId(fragment)).toBe(
      knowledgeReferenceId(reindexed),
    );
  });
  it('una carga más nueva o versión numérica mayor de otro documento no resuelve una tarifa contradictoria', () => {
    const fragments = pair(
      'Tarifa de consulta: 125 EUR.',
      'Tarifa de consulta: 150 EUR.',
      { version: 99, document_updated_at: '2026-10-23T00:00:00Z' },
    );
    const review = reviewKnowledge(fragments, now);
    expect(review.conflicts).toMatchObject([
      {
        fact: 'tarifa de consulta',
        resolution: 'UNRESOLVED',
        preferred_reference_id: null,
      },
    ]);
    expect(evaluateKnowledgePolicy(review)).toEqual({
      action: 'REVIEW_REQUIRED',
      reasons: ['KNOWLEDGE_CONFLICT'],
    });
  });
  it('resuelve de forma explícita por vigencia declarada antes de autoridad', () => {
    const fragments = pair('Tarifa: 125 EUR.', 'Tarifa: 150 EUR.', {
      source_priority: 100,
      valid_from: '2026-01-01',
    });
    const review = reviewKnowledge(fragments, now);
    expect(review.conflicts[0]).toMatchObject({
      resolution: 'PREFER_CURRENT',
      preferred_reference_id: knowledgeReferenceId(fragments[1]),
    });
    expect(review.omitted).toContainEqual({
      reference_id: knowledgeReferenceId(fragments[0]),
      reason: 'CONFLICTING_VALUE',
    });
    expect(evaluateKnowledgePolicy(review).action).toBe('ALLOW_DRAFT');
  });
  it('aplica la autoridad configurada e informa del valor descartado', () => {
    const fragments = pair('Plazo: 7 días.', 'Plazo: 10 días.', {
      source_priority: 10,
    });
    const review = reviewKnowledge(fragments, now);
    expect(review.conflicts[0]).toMatchObject({
      resolution: 'PREFER_AUTHORITY',
      preferred_reference_id: knowledgeReferenceId(fragments[0]),
    });
    expect(review.omitted[0].reference_id).toBe(
      knowledgeReferenceId(fragments[1]),
    );
  });
  it('no considera que dos periodos vigentes solapados se sustituyan por tener inicios diferentes', () => {
    const fragments = pair('Tarifa: 125 EUR.', 'Tarifa: 150 EUR.', {
      valid_from: '2026-10-01',
    });
    fragments[0].valid_from = '2026-01-01';
    expect(reviewKnowledge(fragments, now).conflicts[0].resolution).toBe(
      'UNRESOLVED',
    );
  });
  it('descarta caducados y futuros y solicita revisión si no queda evidencia válida', () => {
    const fragments = pair('Tarifa: 125 EUR.', 'Tarifa: 150 EUR.', {
      valid_from: '2027-01-01',
    });
    fragments[0].valid_until = '2025-12-31';
    const review = reviewKnowledge(fragments, now);
    expect(review.conflicts).toEqual([]);
    expect(review.omitted.map((o) => o.reason)).toEqual([
      'EXPIRED',
      'NOT_YET_VALID',
    ]);
    expect(evaluateKnowledgePolicy(review)).toEqual({
      action: 'REVIEW_REQUIRED',
      reasons: ['KNOWLEDGE_NOT_CURRENT'],
    });
  });
  it.each([
    ['Tarifa: 125,50 euros.', 'Tarifa: 125.50 EUR.'],
    ['Tarifa: 1.250,50 EUR.', 'Tarifa: 1,250.50 €.'],
    ['El plazo de entrega es de siete días.', 'Plazo de entrega: 7 días.'],
  ])('normaliza cantidades equivalentes sin crear conflictos: %s', (a, b) => {
    expect(reviewKnowledge(pair(a, b), now).conflicts).toEqual([]);
  });
  it('detecta negaciones explícitas pero no mezcla servicios o hechos diferentes', () => {
    expect(
      reviewKnowledge(
        pair('Se permiten devoluciones.', 'No se permiten devoluciones.'),
        now,
      ).conflicts,
    ).toHaveLength(1);
    expect(
      reviewKnowledge(
        pair('Tarifa de consulta: 125 EUR.', 'Tarifa de auditoría: 150 EUR.'),
        now,
      ).conflicts,
    ).toEqual([]);
    expect(
      reviewKnowledge(pair('Tarifa: 125 EUR.', 'Plazo: 7 días.'), now)
        .conflicts,
    ).toEqual([]);
  });
  it('omite comparaciones entre fragmentos del mismo documento', () => {
    expect(
      reviewKnowledge(
        pair('Tarifa: 125 EUR.', 'Tarifa: 150 EUR.', {
          document_id: knowledgeId(201),
        }),
        now,
      ).conflicts,
    ).toEqual([]);
  });
  it('acota la salida de conflictos y comunica una revisión incompleta a políticas', () => {
    const fragments = Array.from({ length: 15 }, (_, i) =>
      knowledgeFragment({
        content: `Tarifa: ${i + 1} EUR.`,
        document_id: knowledgeId(200 + i),
        chunk_id: knowledgeId(100 + i),
      }),
    );
    const review = reviewKnowledge(fragments, now);
    expect(review.conflicts).toHaveLength(64);
    expect(review.incomplete).toBe(true);
    expect(evaluateKnowledgePolicy(review).action).toBe('REVIEW_REQUIRED');
  });
  it.each([
    { validFrom: '2026-02-30', validUntil: null },
    { validFrom: '2026-12-01', validUntil: '2026-01-01' },
    { validFrom: 'infinity', validUntil: null },
    { validFrom: null, validUntil: null, userId: knowledgeId(1) },
  ])(
    'rechaza fechas imposibles, intervalos invertidos y propietario inyectado',
    (input) => {
      expect(documentValiditySchema.safeParse(input).success).toBe(false);
    },
  );
});
