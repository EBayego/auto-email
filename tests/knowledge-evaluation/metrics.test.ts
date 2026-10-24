import { describe, expect, it } from 'vitest';
import {
  scoreRetrieval,
  summarizeRetrieval,
  type EvaluationObservation,
} from './metrics';

const target = {
  documentId: 'current',
  version: 2,
  quote: 'Tarifa: 125 euros.',
};
const hit = { ...target, content: target.quote, authorized: true };
const observation = (
  extra: Partial<EvaluationObservation> = {},
): EvaluationObservation => ({
  id: 'query',
  category: 'literal',
  expected: [target],
  retrieved: [hit],
  expectedDisposition: 'ANSWERABLE',
  actualDisposition: 'ANSWERABLE',
  ...extra,
});
describe('MAIL-042 métricas sobre evidencia y resultados esperados independientes', () => {
  it('calcula el rango y penaliza resultados irrelevantes', () => {
    expect(
      scoreRetrieval(
        observation({ retrieved: [{ ...hit, documentId: 'noise' }, hit] }),
      ),
    ).toMatchObject({
      hitAt1: 0,
      hitAtK: 1,
      reciprocalRank: 0.5,
      precision: 0.5,
      recall: 1,
    });
  });
  it.each([
    { ...hit, version: 1 },
    { ...hit, content: 'Tarifa: 999 euros.' },
    { ...hit, documentId: 'other-owner' },
    { ...hit, authorized: false },
  ])(
    'no concede un acierto a una revisión, cita o permiso incorrecto (%j)',
    (fragment) => {
      expect(
        scoreRetrieval(observation({ retrieved: [fragment] })),
      ).toMatchObject({
        hitAt1: 0,
        hitAtK: 0,
        reciprocalRank: 0,
        recall: 0,
        precision: 0,
      });
    },
  );
  it('mide recuperación de varias evidencias sin inflarla por duplicados', () => {
    expect(
      scoreRetrieval(
        observation({
          expected: [target, { ...target, quote: 'Horario: lunes.' }],
          retrieved: [hit, hit],
        }),
      ),
    ).toMatchObject({ recall: 0.5 });
  });
  it('penaliza una consulta positiva sin resultados', () => {
    expect(scoreRetrieval(observation({ retrieved: [] }))).toMatchObject({
      hitAt1: 0,
      recall: 0,
      precision: 0,
    });
  });
  it('separa las abstenciones del ranking y cuenta sus fallos y fugas', () => {
    const positive = scoreRetrieval(observation());
    const absent = scoreRetrieval(
      observation({
        id: 'absent',
        expected: [],
        retrieved: [{ ...hit, authorized: false }],
        expectedDisposition: 'HUMAN_INPUT',
      }),
    );
    expect(absent).toMatchObject({
      hitAt1: null,
      recall: null,
      precision: null,
      dispositionCorrect: false,
    });
    expect(summarizeRetrieval([positive, absent])).toMatchObject({
      queries: 2,
      evidenceQueries: 1,
      abstentionQueries: 1,
      hitAt1: 1,
      meanReciprocalRank: 1,
      overallPrecision: 0.5,
      dispositionAccuracy: 0.5,
      abstentionAccuracy: 0,
      unauthorizedFragments: 1,
    });
  });
  it('una evaluación vacía o solo negativa no simula un ranking perfecto', () => {
    expect(summarizeRetrieval([])).toMatchObject({
      queries: 0,
      hitAt1: null,
      meanRecall: null,
      dispositionAccuracy: null,
    });
    expect(
      summarizeRetrieval([
        scoreRetrieval(
          observation({
            expected: [],
            retrieved: [],
            expectedDisposition: 'HUMAN_INPUT',
            actualDisposition: 'HUMAN_INPUT',
          }),
        ),
      ]),
    ).toMatchObject({
      hitAt1: null,
      overallPrecision: null,
      abstentionAccuracy: 1,
    });
  });
});
