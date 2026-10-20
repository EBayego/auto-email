import {
  evaluationModes,
  styleDimensions,
  type EvaluationMode,
} from '@/modules/identity/style-evaluation';
import type { StyleCaseResult } from './evaluate-style';
import { summarizeAutomaticStyleEvaluation } from './style-evaluation-automatic-summary';

export function summarizeStyleEvaluation(cases: readonly StyleCaseResult[]) {
  const paired = cases.filter(
    (item) =>
      item.variants.length === 3 &&
      item.variants.every(
        (variant) => variant.status === 'READY' && variant.human,
      ),
  );
  const means = Object.fromEntries(
    evaluationModes.map((mode) => {
      const ratings = paired.map(
        (item) =>
          item.variants.find((variant) => variant.mode === mode)!.human!,
      );
      const dimensions = Object.fromEntries(
        styleDimensions.map((dimension) => [
          dimension,
          ratings.length
            ? ratings.reduce(
                (sum, rating) => sum + rating.scores[dimension],
                0,
              ) / ratings.length
            : null,
        ]),
      );
      return [
        mode,
        {
          dimensions,
          mean: ratings.length
            ? ratings.reduce(
                (sum, rating) =>
                  sum +
                  styleDimensions.reduce(
                    (n, key) => n + rating.scores[key],
                    0,
                  ) /
                    5,
                0,
              ) / ratings.length
            : null,
          acceptableRate: ratings.length
            ? ratings.filter((r) => r.acceptable).length / ratings.length
            : null,
          unsafe: ratings.filter((r) => !r.safe).length,
        },
      ];
    }),
  ) as Record<
    EvaluationMode,
    {
      dimensions: Record<string, number | null>;
      mean: number | null;
      acceptableRate: number | null;
      unsafe: number;
    }
  >;
  const regressions = paired.flatMap((item) =>
    (['GENERAL', 'CONTEXTUAL'] as const).flatMap((mode) => {
      const baselineMode = mode === 'GENERAL' ? 'UNPERSONALIZED' : 'GENERAL';
      const variant = item.variants.find((v) => v.mode === mode)!,
        baseline = item.variants.find((v) => v.mode === baselineMode)!;
      const dimensions = styleDimensions.filter(
        (key) => variant.human!.scores[key] < baseline.human!.scores[key],
      );
      return dimensions.length ||
        !variant.human!.safe ||
        (baseline.human!.acceptable && !variant.human!.acceptable)
        ? [
            {
              caseId: item.caseId,
              mode,
              baselineMode,
              dimensions,
              factors: variant.human!.factors,
            },
          ]
        : [];
    }),
  );
  const complete =
    cases.length > 0 &&
    cases.every(
      (item) =>
        item.humanReviewPerformed &&
        item.variants.every(
          (variant) => variant.status !== 'READY' || variant.human,
        ),
    );
  const genuineContextPairs = paired.filter(
    (item) =>
      !['GENERAL', 'NONE', 'UNAVAILABLE'].includes(
        item.variants.find((v) => v.mode === 'CONTEXTUAL')!.effectiveScope,
      ),
  ).length;
  let recommendation:
    | 'PENDING_HUMAN_REVIEW'
    | 'INSUFFICIENT_PAIRED_EVIDENCE'
    | 'KEEP_CURRENT_AND_REVIEW_REGRESSIONS'
    | 'GENERAL'
    | 'CONTEXTUAL' = !complete
    ? 'PENDING_HUMAN_REVIEW'
    : paired.length < 10 || paired.length / cases.length < 0.8
      ? 'INSUFFICIENT_PAIRED_EVIDENCE'
      : 'KEEP_CURRENT_AND_REVIEW_REGRESSIONS';
  const improves = (mode: EvaluationMode, baseline: EvaluationMode) =>
    means[mode].unsafe === 0 &&
    means[mode].acceptableRate! >= 0.8 &&
    means[mode].mean! >= means[baseline].mean! + 0.2 &&
    styleDimensions.every(
      (key) => means[mode].dimensions[key]! >= means[baseline].dimensions[key]!,
    );
  if (complete && paired.length >= 10 && paired.length / cases.length >= 0.8) {
    if (improves('GENERAL', 'UNPERSONALIZED')) recommendation = 'GENERAL';
    if (
      genuineContextPairs >= 10 &&
      improves('CONTEXTUAL', 'GENERAL') &&
      improves('CONTEXTUAL', 'UNPERSONALIZED')
    )
      recommendation = 'CONTEXTUAL';
  }
  return {
    humanReview: complete ? 'COMPLETE' : 'PENDING',
    evaluatedCases: cases.length,
    pairedCases: paired.length,
    genuineContextPairs,
    means,
    regressions,
    recommendation,
    automaticallyChangesMvp: false,
    automatic: summarizeAutomaticStyleEvaluation(cases),
    ready: Object.fromEntries(
      evaluationModes.map((mode) => [
        mode,
        cases.filter(
          (item) =>
            item.variants.find((v) => v.mode === mode)?.status === 'READY',
        ).length,
      ]),
    ),
  };
}
