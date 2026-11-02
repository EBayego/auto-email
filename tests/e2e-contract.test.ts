import { describe, expect, it } from 'vitest';
import { scenarios } from './e2e/scenarios';
describe('MAIL-065 escenarios críticos obligatorios', () => {
  it('mantiene los dieciséis riesgos funcionales del backlog sin duplicados ni omisiones', () => {
    expect(scenarios.map((s) => s.id).sort()).toEqual(
      [
        'simple',
        'newsletter',
        'no-reply',
        'answered',
        'manual-draft',
        'twice',
        'multiple',
        'insufficient',
        'expired',
        'authority',
        'injection',
        'disconnected',
        'google-retry',
        'isolation',
        'late-reply',
        'english',
      ].sort(),
    );
    expect(new Set(scenarios.map((s) => s.title)).size).toBe(16);
  });
  it('solo autoriza escrituras en casos cuyo resultado exige un borrador', () => {
    for (const scenario of scenarios) {
      expect(scenario.text.trim()).not.toBe('');
      expect(scenario.drafts).toBe(scenario.status === 'DRAFT_CREATED' ? 1 : 0);
    }
  });
});
