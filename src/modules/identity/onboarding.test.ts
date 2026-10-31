import { describe, expect, it } from 'vitest';
import {
  parseOnboardingOperation,
  onboardingConsentVersion,
} from './onboarding';
const scope = {
  after: '2026-01-01',
  before: '2026-10-18',
  maxCandidates: 200,
  excludedAddresses: [],
  excludedDomains: [],
};
const consent = {
  action: 'consent',
  consent: true,
  version: onboardingConsentVersion,
  scope,
};
describe('MAIL-051 consentimiento y alcance', () => {
  it('normaliza exclusiones y acepta un alcance acotado', () => {
    expect(
      parseOnboardingOperation({
        ...consent,
        scope: {
          ...scope,
          excludedAddresses: ['Contact@example.com', 'contact@example.com'],
        },
      }),
    ).toMatchObject({ scope: { excludedAddresses: ['contact@example.com'] } });
  });
  it.each([
    { ...consent, consent: false },
    { ...consent, consent: undefined },
    { ...consent, version: 'other' },
    { ...consent, userId: 'victim' },
    { ...consent, scope: { ...scope, after: '2026-02-30' } },
    { ...consent, scope: { ...scope, before: '2026-01-01' } },
    { ...consent, scope: { ...scope, before: '2099-01-01' } },
    { ...consent, scope: { ...scope, maxCandidates: 501 } },
    { ...consent, scope: { ...scope, excludedDomains: ['bad) OR in:inbox'] } },
    { action: 'start', revision: 'bad' },
    { action: 'start', revision: crypto.randomUUID(), userId: 'victim' },
  ])('rechaza consentimiento o alcance no autorizado: %j', (input) =>
    expect(() => parseOnboardingOperation(input)).toThrow('INVALID_INPUT'),
  );
});
