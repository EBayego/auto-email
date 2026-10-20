import { describe, expect, it } from 'vitest';
import {
  blindOrder,
  measureStyle,
  validateEvaluationCorpus,
  validateHumanStyleRating,
} from './style-evaluation';
import {
  evaluationFixture,
  syntheticRating,
} from '../../../tests/fixtures/style-evaluation';
describe('conjunto reservado y métricas de estilo', () => {
  it('valida solo referencias y parámetros minimizados, sin permitir cuerpos en el corpus', () => {
    const f = evaluationFixture();
    expect(validateEvaluationCorpus(f.corpus, f.identity, f.now)).toEqual(
      f.corpus,
    );
    expect(() =>
      validateEvaluationCorpus(
        { ...f.corpus, body: 'private' },
        f.identity,
        f.now,
      ),
    ).toThrow('INVALID_EVALUATION');
  });
  it('rechaza otra cuenta, caducidad, hilos repetidos y respuestas reutilizadas', () => {
    const f = evaluationFixture();
    expect(() =>
      validateEvaluationCorpus(
        f.corpus,
        {
          ...f.identity,
          gmailAccountId: '00000000-0000-4000-8000-000000000099',
        },
        f.now,
      ),
    ).toThrow('ACCOUNT_MISMATCH');
    expect(() =>
      validateEvaluationCorpus(f.corpus, f.identity, new Date('2027-01-02')),
    ).toThrow('EXPIRED_EVALUATION');
    f.corpus.cases[1] = f.corpus.cases[0];
    expect(() => validateEvaluationCorpus(f.corpus, f.identity, f.now)).toThrow(
      'INVALID_EVALUATION',
    );
  });
  it('reproduce la permutación por caso y semilla y varía las posiciones entre casos', () => {
    const orders = Array.from({ length: 20 }, (_, i) =>
      blindOrder('fixed', String(i)),
    );
    expect(orders[0]).toEqual(blindOrder('fixed', '0'));
    expect(
      new Set(orders.map((order) => order.join(','))).size,
    ).toBeGreaterThan(3);
    expect(orders.every((order) => new Set(order).size === 3)).toBe(true);
  });
  it('calcula proxies explícitos sin convertirlos en valoración humana', () => {
    const metrics = measureStyle(
      'Hola, he recibido tu mensaje. Gracias.',
      'Hello, I received your email. Thank you.',
    );
    expect(metrics).toMatchObject({
      greetingMatch: false,
      languageMatch: false,
    });
    expect(metrics.lengthRatio).toBeGreaterThan(0);
    expect(metrics).not.toHaveProperty('quality');
    expect(measureStyle('', '')).toMatchObject({
      formalityMatch: null,
      lengthRatio: null,
      languageMatch: null,
      vocabularyJaccard: null,
    });
  });
  it('valida puntuaciones completas de cinco dimensiones y factores cerrados', () => {
    expect(validateHumanStyleRating(syntheticRating(4))).toEqual(
      syntheticRating(4),
    );
    expect(() => validateHumanStyleRating(syntheticRating(6))).toThrow(
      'INCOMPLETE_REVIEW',
    );
    expect(() =>
      validateHumanStyleRating({
        ...syntheticRating(3),
        factors: ['private free text'],
      }),
    ).toThrow('INCOMPLETE_REVIEW');
    expect(() =>
      validateHumanStyleRating({
        ...syntheticRating(3),
        factors: ['length', 'length'],
      }),
    ).toThrow('INCOMPLETE_REVIEW');
  });
});
