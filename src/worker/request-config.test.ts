import { describe, expect, it } from 'vitest';
import { readRequestPolicyConfig } from './request-config';
describe('MAIL-033 configuración de límites', () => {
  it('define intentos finitos y límites distintos por cuenta y proveedor', () => {
    expect(readRequestPolicyConfig({})).toMatchObject({
      maxAttempts: 3,
      maxElapsedMs: 120000,
      leaseSeconds: 40,
      limits: {
        google: {
          maxConcurrent: 4,
          accountMaxConcurrent: 1,
          requestsPerMinute: 120,
          accountRequestsPerMinute: 60,
        },
        openai: {
          maxConcurrent: 2,
          requestsPerMinute: 30,
          accountRequestsPerMinute: 10,
        },
      },
    });
  });
  it.each([
    { WORKER_PROVIDER_MAX_ATTEMPTS: '0' },
    { WORKER_PROVIDER_MAX_ATTEMPTS: '6' },
    { WORKER_PROVIDER_MAX_ELAPSED_MS: 'Infinity' },
    { WORKER_ACCOUNT_MAX_CONCURRENT: '-1' },
    { WORKER_GMAIL_REQUESTS_PER_MINUTE: '1.5' },
    {
      WORKER_PROVIDER_BASE_DELAY_MS: '1000',
      WORKER_PROVIDER_MAX_DELAY_MS: '100',
    },
    { WORKER_OPENAI_ACCOUNT_REQUESTS_PER_MINUTE: '' },
  ])('rechaza límites inválidos %j', (env) =>
    expect(() => readRequestPolicyConfig(env)).toThrow(),
  );
});
