import {
  evaluationModes,
  styleDimensions,
} from '@/modules/identity/style-evaluation';
import { additionalStyleDimensions } from '@/modules/identity/style-evaluation-judge';
import type { StyleCaseResult } from './evaluate-style';

export function summarizeAutomaticStyleEvaluation(
  cases: readonly StyleCaseResult[],
) {
  const dimensions = [...styleDimensions, ...additionalStyleDimensions];
  const score = (
    variant: StyleCaseResult['variants'][number],
    dimension: (typeof dimensions)[number],
  ) =>
    dimension in variant.automatic!.scores
      ? variant.automatic!.scores[dimension as (typeof styleDimensions)[number]]
      : variant.automatic!.additionalScores[
          dimension as (typeof additionalStyleDimensions)[number]
        ];
  const paired = cases.filter(
    (item) =>
      item.variants.length === 3 &&
      item.variants.every((v) => v.status === 'READY' && v.automatic),
  );
  const rated = cases.filter((item) => item.variants.some((v) => v.automatic));
  const complete =
    rated.length > 0 &&
    cases.every((item) =>
      item.variants.every((v) => v.status !== 'READY' || v.automatic),
    );
  const means = Object.fromEntries(
    evaluationModes.map((mode) => {
      const variants = paired.map((item) =>
        item.variants.find((v) => v.mode === mode)!,
      );
      const byDimension = Object.fromEntries(
        dimensions.map((key) => [
          key,
          variants.length
            ? variants.reduce((sum, variant) => sum + score(variant, key), 0) /
              variants.length
            : null,
        ]),
      );
      return [
        mode,
        {
          dimensions: byDimension,
          mean: variants.length
            ? variants.reduce(
                (sum, variant) =>
                  sum +
                  dimensions.reduce((n, key) => n + score(variant, key), 0) /
                    dimensions.length,
                0,
              ) / variants.length
            : null,
          acceptableRate: variants.length
            ? variants.filter((v) => v.automatic!.acceptable).length /
              variants.length
            : null,
          unsafe: variants.filter((v) => !v.automatic!.safe).length,
        },
      ];
    }),
  ) as Record<
    (typeof evaluationModes)[number],
    {
      dimensions: Record<string, number | null>;
      mean: number | null;
      acceptableRate: number | null;
      unsafe: number;
    }
  >;
  const factors: Record<string, number> = {};
  for (const item of rated)
    for (const variant of item.variants)
      for (const factor of variant.automatic?.factors ?? [])
        factors[factor] = (factors[factor] ?? 0) + 1;
  const reviewCandidates = rated.flatMap((item) => {
    const reasons = new Set<string>();
    for (const variant of item.variants) {
      if (variant.mode === 'UNPERSONALIZED') continue;
      const rating = variant.automatic;
      if (!rating) continue;
      if (rating.confidence === 'low') reasons.add('LOW_CONFIDENCE');
      if (!rating.safe) reasons.add('UNSAFE');
      if (!rating.acceptable) reasons.add('UNACCEPTABLE');
      if (dimensions.some((key) => score(variant, key) <= 2))
        reasons.add('LOW_STYLE_SIMILARITY');
    }
    return reasons.size ? [{ caseId: item.caseId, reasons: [...reasons] }] : [];
  });
  const regressions = paired.flatMap((item) =>
    (['GENERAL', 'CONTEXTUAL'] as const).flatMap((mode) => {
      const baselineMode = mode === 'GENERAL' ? 'UNPERSONALIZED' : 'GENERAL';
      const variant = item.variants.find((v) => v.mode === mode)!;
      const baseline = item.variants.find((v) => v.mode === baselineMode)!;
      const worse = dimensions.filter(
        (key) => score(variant, key) < score(baseline, key),
      );
      return worse.length ||
        !variant.automatic!.safe ||
        (baseline.automatic!.acceptable && !variant.automatic!.acceptable)
        ? [
            {
              caseId: item.caseId,
              mode,
              baselineMode,
              dimensions: worse,
              factors: variant.automatic!.factors,
            },
          ]
        : [];
    }),
  );
  const genuineContextPairs = paired.filter(
    (item) =>
      !['GENERAL', 'NONE', 'UNAVAILABLE'].includes(
        item.variants.find((v) => v.mode === 'CONTEXTUAL')!.effectiveScope,
      ),
  ).length;
  const improves = (
    mode: (typeof evaluationModes)[number],
    baseline: (typeof evaluationModes)[number],
  ) =>
    means[mode].unsafe === 0 &&
    means[mode].acceptableRate! >= 0.8 &&
    means[mode].mean! >= means[baseline].mean! + 0.2 &&
    dimensions.every(
      (key) => means[mode].dimensions[key]! >= means[baseline].dimensions[key]!,
    );
  let recommendation = 'INSUFFICIENT_PAIRED_EVIDENCE';
  if (complete && paired.length >= 10 && paired.length / cases.length >= 0.8) {
    recommendation = 'REVIEW_STYLE';
    if (improves('GENERAL', 'UNPERSONALIZED')) recommendation = 'GENERAL';
    if (
      genuineContextPairs >= 10 &&
      improves('CONTEXTUAL', 'GENERAL') &&
      improves('CONTEXTUAL', 'UNPERSONALIZED')
    )
      recommendation = 'CONTEXTUAL';
  }
  return {
    status: complete ? 'COMPLETE' : rated.length ? 'PARTIAL' : 'NOT_RUN',
    evidence: 'UNCALIBRATED_MODEL_JUDGE',
    ratedCases: rated.length,
    pairedCases: paired.length,
    genuineContextPairs,
    means,
    factors,
    regressions,
    reviewCandidates,
    recommendation,
    automaticallyChangesMvp: false,
  };
}
