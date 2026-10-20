import { describe, expect, it } from 'vitest';
import { summarizeStyleEvaluation } from './style-evaluation-summary';
import type { StyleCaseResult } from './evaluate-style';
import { evaluationModes } from '@/modules/identity/style-evaluation';
import {
  syntheticRating,
  syntheticAutomaticRating,
} from '../../tests/fixtures/style-evaluation';
function cases(): StyleCaseResult[] {
  return Array.from({ length: 10 }, (_, i) => ({
    caseId: `case-${i + 1}`,
    humanReviewPerformed: true,
    variants: evaluationModes.map((mode, index) => ({
      mode,
      effectiveScope:
        index === 2 ? 'RECIPIENT' : index === 1 ? 'GENERAL' : 'NONE',
      profileFingerprint: null,
      status: 'READY',
      examplesUsed: 0,
      modelCalls: 2,
      inputTokens: 10,
      outputTokens: 10,
      proxies: null,
      human: syntheticRating(index + 2),
    })),
  }));
}
describe('decisiones de evaluación calibradas por revisión humana', () => {
  it('distingue notas automáticas, registra calidez y despedida y señala casos dudosos sin promover un fallback', () => {
    const values = cases();
    values.forEach((item) => {
      item.humanReviewPerformed = false;
      item.variants.forEach((variant, index) => {
        variant.human = null;
        variant.automatic = syntheticAutomaticRating(index + 2);
      });
      item.variants[2].effectiveScope = 'GENERAL';
    });
    values[0].variants[1].automatic = syntheticAutomaticRating(3, {
      confidence: 'low',
      factors: ['closing', 'warmth'],
      additionalScores: { closing: 1, warmth: 1, helpfulness: 2 },
    });
    const summary = summarizeStyleEvaluation(values);
    expect(summary).toMatchObject({
      humanReview: 'PENDING',
      pairedCases: 0,
      automatic: {
        status: 'COMPLETE',
        pairedCases: 10,
        genuineContextPairs: 0,
        recommendation: 'GENERAL',
        factors: { closing: 1, warmth: 1 },
        automaticallyChangesMvp: false,
      },
    });
    expect(summary.automatic.reviewCandidates).toContainEqual({
      caseId: 'case-1',
      reasons: expect.arrayContaining([
        'LOW_STYLE_SIMILARITY',
        'LOW_CONFIDENCE',
      ]),
    });
    expect(summary.automatic.regressions).toContainEqual(
      expect.objectContaining({
        mode: 'GENERAL',
        dimensions: ['closing', 'warmth'],
      }),
    );
  });
  it('registra factores y dimensiones donde la personalización empeora aunque mejore la media', () => {
    const values = cases();
    const context = values[0].variants[2];
    context.human = syntheticRating(5, {
      scores: {
        greeting: 5,
        formality: 5,
        vocabulary: 5,
        length: 1,
        language: 5,
      },
      factors: ['length', 'irrelevant_examples'],
    });
    const result = summarizeStyleEvaluation(values);
    expect(result.regressions).toContainEqual(
      expect.objectContaining({
        caseId: 'case-1',
        mode: 'CONTEXTUAL',
        dimensions: ['length'],
        factors: ['length', 'irrelevant_examples'],
      }),
    );
    expect(result.automaticallyChangesMvp).toBe(false);
  });
  it('no promueve una configuración insegura ni una dimensión con regresión media', () => {
    const values = cases();
    values.forEach(
      (c) => (c.variants[2].human = syntheticRating(5, { safe: false })),
    );
    expect(summarizeStyleEvaluation(values).recommendation).toBe('GENERAL');
    values.forEach((c) => (c.variants[1].human = syntheticRating(1)));
    expect(summarizeStyleEvaluation(values).recommendation).toBe(
      'KEEP_CURRENT_AND_REVIEW_REGRESSIONS',
    );
  });
  it('no atribuye una mejora contextual al fallback general', () => {
    const values = cases();
    values.forEach((c) => (c.variants[2].effectiveScope = 'GENERAL'));
    expect(summarizeStyleEvaluation(values)).toMatchObject({
      genuineContextPairs: 0,
      recommendation: 'GENERAL',
    });
  });
  it('no compara cohortes distintas ni datos incompletos o insuficientes', () => {
    const values = cases();
    values[0].variants[2].human = null;
    expect(summarizeStyleEvaluation(values)).toMatchObject({
      pairedCases: 9,
      humanReview: 'PENDING',
      recommendation: 'PENDING_HUMAN_REVIEW',
    });
    values[0].variants[2].human = syntheticRating(4);
    expect(summarizeStyleEvaluation(values.slice(0, 9)).recommendation).toBe(
      'INSUFFICIENT_PAIRED_EVIDENCE',
    );
  });
  it('una ejecución sin propuestas no se convierte en revisión humana completa', () => {
    const values = cases();
    values.forEach((c) => {
      c.humanReviewPerformed = false;
      c.variants.forEach((v) => {
        v.status = 'BLOCKED';
        v.human = null;
      });
    });
    expect(summarizeStyleEvaluation(values)).toMatchObject({
      humanReview: 'PENDING',
      pairedCases: 0,
      recommendation: 'PENDING_HUMAN_REVIEW',
    });
  });
});
