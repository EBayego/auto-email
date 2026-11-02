import { z } from 'zod';
export const analyticsVersion = 'mail060-v1';
export const analyticsQuerySchema = z.strictObject({
  days: z.enum(['7', '30', '90']).default('30'),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
const count = z.int().min(0).max(Number.MAX_SAFE_INTEGER),
  amount = z.number().finite().nonnegative().nullable();
export const analyticsTotalsSchema = z.strictObject({
  generationAttempts: count,
  generationFailures: count,
  usageKnownGenerations: count,
  usageUnknownGenerations: count,
  inputTokens: count,
  outputTokens: count,
  modelCalls: count,
  pricedGenerations: count,
  unpricedGenerations: count,
  knownCostUsd: amount,
  meanKnownCostUsd: amount,
  meanDurationMs: amount,
  draftAttempts: count,
  draftsCreated: count,
  sendsConfirmed: count,
  independentReplies: count,
  discardedBeforeWrite: count,
  indeterminate: count,
  pending: count,
  compared: count,
  edited: count,
  unchanged: count,
  factualReview: count,
  contentReview: count,
  comparisonSkipped: count,
  comparisonPending: count,
  totalEditDistance: count,
  meanSimilarity: z.number().min(0).max(1).nullable(),
  jobTotal: count,
  skippedJobs: count,
  reviewJobs: count,
  failedJobs: count,
  classificationInputTokens: count,
  classificationOutputTokens: count,
});
export type AnalyticsTotals = z.infer<typeof analyticsTotalsSchema>;
const time = z.iso.datetime({ offset: true });
const reason = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  count,
});
export const analyticsSnapshotSchema = z.strictObject({
  version: z.literal(analyticsVersion),
  timezone: z.literal('Europe/Madrid'),
  observedAt: time,
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  current: z.strictObject({
    from: time,
    to: time,
    totals: analyticsTotalsSchema,
  }),
  previous: z.strictObject({
    from: time,
    to: time,
    totals: analyticsTotalsSchema,
  }),
  daily: z
    .array(
      z.strictObject({
        day: z.iso.date(),
        generationAttempts: count,
        draftsCreated: count,
        sendsConfirmed: count,
        compared: count,
        edited: count,
        knownCostUsd: amount,
      }),
    )
    .max(90),
  omissionReasons: z.array(reason).max(10),
  omissionOther: count,
  reviewReasons: z.array(reason).max(10),
  reviewOther: count,
});
export type AnalyticsSnapshot = z.infer<typeof analyticsSnapshotSchema>;
export function observedRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}
export function analyticsRates(t: AnalyticsTotals) {
  return {
    usage: observedRatio(t.sendsConfirmed, t.draftsCreated),
    edited: observedRatio(t.edited, t.compared),
    unchanged: observedRatio(t.unchanged, t.compared),
    comparisonCoverage: observedRatio(t.compared, t.sendsConfirmed),
    costCoverage: observedRatio(t.pricedGenerations, t.generationAttempts),
    usageCoverage: observedRatio(t.usageKnownGenerations, t.generationAttempts),
  };
}
export const timeAssumptionsSchema = z.strictObject({
  manualMinutes: z.number().finite().min(0.1).max(120),
  reviewMinutes: z.number().finite().min(0).max(120),
  secondsPerEdit: z.number().finite().min(0).max(60),
});
export type TimeAssumptions = z.infer<typeof timeAssumptionsSchema>;
export function estimateSavedMinutes(
  t: Pick<AnalyticsTotals, 'compared' | 'totalEditDistance'>,
  assumptions: TimeAssumptions | null,
) {
  if (!assumptions || t.compared === 0) return null;
  const value = timeAssumptionsSchema.parse(assumptions);
  // Applies only to compared sends; waiting for background processing is not user effort.
  return (
    Math.round(
      (t.compared * (value.manualMinutes - value.reviewMinutes) -
        (t.totalEditDistance * value.secondsPerEdit) / 60) *
        100,
    ) / 100
  );
}
export function rateDelta(current: number | null, previous: number | null) {
  return current === null || previous === null
    ? null
    : (current - previous) * 100;
}
