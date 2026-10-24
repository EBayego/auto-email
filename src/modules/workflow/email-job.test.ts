import { describe, expect, it } from 'vitest';
import {
  canTransitionEmailJob,
  emailJobStatuses,
  jobClassification,
} from './email-job';

describe('MAIL-031 máquina de estados', () => {
  it.each([
    ['PENDING', 'CLASSIFYING'],
    ['CLASSIFYING', 'SKIPPED'],
    ['CLASSIFYING', 'GENERATING'],
    ['CLASSIFYING', 'REVIEW_REQUIRED'],
    ['CLASSIFYING', 'FAILED'],
    ['CLASSIFYING', 'PENDING'],
    ['GENERATING', 'DRAFT_CREATED'],
    ['GENERATING', 'SKIPPED'],
    ['GENERATING', 'REVIEW_REQUIRED'],
    ['GENERATING', 'FAILED'],
    ['FAILED', 'PENDING'],
  ] as const)('permite %s → %s', (from, to) =>
    expect(canTransitionEmailJob(from, to)).toBe(true),
  );
  it.each(['SKIPPED', 'DRAFT_CREATED', 'REVIEW_REQUIRED'] as const)(
    'no reabre %s automáticamente',
    (from) => {
      for (const to of emailJobStatuses)
        expect(canTransitionEmailJob(from, to)).toBe(false);
    },
  );
  it('no salta clasificación ni permite volver a generar un borrador confirmado', () => {
    expect(canTransitionEmailJob('PENDING', 'DRAFT_CREATED')).toBe(false);
    expect(canTransitionEmailJob('GENERATING', 'CLASSIFYING')).toBe(false);
  });
  it('conserva solo datos estructurados de clasificación, sin explicación libre', () => {
    const stored = jobClassification({
      decision: 'REPLY_REQUIRED',
      intent: 'REQUEST_INFORMATION',
      reasons: ['EXPLICIT_QUESTION'],
      explanation: 'private-content',
      riskFlags: [],
      needsAttachment: false,
      source: 'MODEL',
      modelCalls: 1,
      inputTokens: 12,
      outputTokens: 4,
    });
    expect(stored).not.toHaveProperty('explanation');
    expect(JSON.stringify(stored)).not.toContain('private-content');
  });
});
