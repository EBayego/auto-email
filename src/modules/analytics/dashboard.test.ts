import { describe, expect, it } from 'vitest';
import {
  analyticsRates,
  analyticsQuerySchema,
  analyticsSnapshotSchema,
  estimateSavedMinutes,
  rateDelta,
  timeAssumptionsSchema,
} from './dashboard';
import {
  analyticsFixture,
  emptyAnalyticsTotals,
} from '../../../tests/fixtures/analytics';
describe('MAIL-060 tasas y simulación declarada', () => {
  it('no convierte denominadores vacíos ni costes ausentes en ceros', () => {
    expect(analyticsRates(emptyAnalyticsTotals())).toEqual({
      usage: null,
      edited: null,
      unchanged: null,
      comparisonCoverage: null,
      costCoverage: null,
      usageCoverage: null,
    });
    expect(
      analyticsSnapshotSchema.parse(analyticsFixture()).current.totals
        .knownCostUsd,
    ).toBeNull();
  });
  it('usa los borradores creados para uso y solo las comparaciones para edición', () => {
    const rates = analyticsRates({
      ...emptyAnalyticsTotals(),
      draftsCreated: 10,
      sendsConfirmed: 4,
      compared: 2,
      edited: 1,
      unchanged: 1,
      generationAttempts: 5,
      pricedGenerations: 2,
      usageKnownGenerations: 4,
    });
    expect(rates).toEqual({
      usage: 0.4,
      edited: 0.5,
      unchanged: 0.5,
      comparisonCoverage: 0.5,
      costCoverage: 0.4,
      usageCoverage: 0.8,
    });
  });
  it('solo estima la muestra comparada con hipótesis explícitas y permite pérdida de tiempo', () => {
    const sample = { compared: 4, totalEditDistance: 30 };
    expect(estimateSavedMinutes(sample, null)).toBeNull();
    expect(
      estimateSavedMinutes(
        { compared: 0, totalEditDistance: 0 },
        { manualMinutes: 5, reviewMinutes: 1, secondsPerEdit: 2 },
      ),
    ).toBeNull();
    expect(
      estimateSavedMinutes(sample, {
        manualMinutes: 5,
        reviewMinutes: 1,
        secondsPerEdit: 2,
      }),
    ).toBe(15);
    expect(
      estimateSavedMinutes(sample, {
        manualMinutes: 1,
        reviewMinutes: 2,
        secondsPerEdit: 2,
      }),
    ).toBe(-5);
  });
  it.each([
    { manualMinutes: 0, reviewMinutes: 0, secondsPerEdit: 0 },
    { manualMinutes: 5, reviewMinutes: -1, secondsPerEdit: 0 },
    { manualMinutes: 5, reviewMinutes: 1, secondsPerEdit: Infinity },
    { manualMinutes: 5, reviewMinutes: 1, secondsPerEdit: 61 },
  ])('rechaza hipótesis fuera de límites: %j', (input) =>
    expect(timeAssumptionsSchema.safeParse(input).success).toBe(false),
  );
  it('expresa cambios en puntos porcentuales y no inventa una base anterior', () => {
    expect(rateDelta(0.5, 0.25)).toBe(25);
    expect(rateDelta(0.1, 0.5)).toBe(-40);
    expect(rateDelta(0.1, null)).toBeNull();
    expect(rateDelta(null, 0.1)).toBeNull();
  });
  it('limita periodos y no permite consultar otro usuario', () => {
    expect(analyticsQuerySchema.parse({})).toEqual({ days: '30' });
    expect(analyticsQuerySchema.safeParse({ days: '365' }).success).toBe(false);
    expect(
      analyticsQuerySchema.safeParse({ userId: crypto.randomUUID() }).success,
    ).toBe(false);
  });
});
