export type ExpectedEvidence = {
  documentId: string;
  version: number;
  quote: string;
};
export type RetrievedEvidence = {
  documentId: string;
  version: number;
  content: string;
  authorized: boolean;
};
export type Disposition = 'ANSWERABLE' | 'HUMAN_INPUT';
export type EvaluationObservation = {
  id: string;
  category: string;
  expected: ExpectedEvidence[];
  retrieved: RetrievedEvidence[];
  expectedDisposition: Disposition;
  actualDisposition: Disposition;
};

// A hit requires the expected literal evidence in the expected document revision.
// Ranking averages exclude unanswerable queries rather than granting free hits.
export function scoreRetrieval(observation: EvaluationObservation) {
  const expected = observation.expected;
  const relevant = (fragment: RetrievedEvidence, target: ExpectedEvidence) =>
    fragment.authorized &&
    fragment.documentId === target.documentId &&
    fragment.version === target.version &&
    fragment.content.includes(target.quote);
  const ranks = expected.map((target) =>
    observation.retrieved.findIndex((f) => relevant(f, target)),
  );
  const first = ranks.filter((r) => r >= 0).sort((a, b) => a - b)[0];
  const hits = observation.retrieved.filter((f) =>
    expected.some((target) => relevant(f, target)),
  ).length;
  return {
    id: observation.id,
    category: observation.category,
    expectedEvidence: expected.length,
    returnedFragments: observation.retrieved.length,
    relevantFragments: hits,
    hitAt1: expected.length ? Number(first === 0) : null,
    hitAtK: expected.length ? Number(first !== undefined) : null,
    reciprocalRank: expected.length
      ? first === undefined
        ? 0
        : 1 / (first + 1)
      : null,
    recall: expected.length
      ? ranks.filter((r) => r >= 0).length / expected.length
      : null,
    precision: expected.length
      ? observation.retrieved.length
        ? hits / observation.retrieved.length
        : 0
      : null,
    unauthorizedFragments: observation.retrieved.filter((f) => !f.authorized)
      .length,
    expectedDisposition: observation.expectedDisposition,
    actualDisposition: observation.actualDisposition,
    dispositionCorrect:
      observation.expectedDisposition === observation.actualDisposition,
  };
}
export type RetrievalScore = ReturnType<typeof scoreRetrieval>;
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function summarizeRetrieval(cases: RetrievalScore[]) {
  const positives = cases.filter((c) => c.expectedEvidence > 0);
  const abstentions = cases.filter(
    (c) => c.expectedDisposition === 'HUMAN_INPUT',
  );
  return {
    queries: cases.length,
    evidenceQueries: positives.length,
    abstentionQueries: abstentions.length,
    hitAt1: mean(positives.map((c) => c.hitAt1!)),
    hitAtK: mean(positives.map((c) => c.hitAtK!)),
    meanReciprocalRank: mean(positives.map((c) => c.reciprocalRank!)),
    meanRecall: mean(positives.map((c) => c.recall!)),
    meanPrecision: mean(positives.map((c) => c.precision!)),
    overallPrecision: cases.some((c) => c.returnedFragments > 0)
      ? cases.reduce((sum, c) => sum + c.relevantFragments, 0) /
        cases.reduce((sum, c) => sum + c.returnedFragments, 0)
      : null,
    dispositionAccuracy: mean(cases.map((c) => Number(c.dispositionCorrect))),
    abstentionAccuracy: mean(
      abstentions.map((c) => Number(c.dispositionCorrect)),
    ),
    unauthorizedFragments: cases.reduce(
      (sum, c) => sum + c.unauthorizedFragments,
      0,
    ),
  };
}
