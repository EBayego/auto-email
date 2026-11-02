import { describe, expect, it, vi } from 'vitest';
import { safeOperationalEvent, logOperationalEvent } from './operational-log';
describe('MAIL-062 logs operativos sin datos personales', () => {
  it('omite tokens, cuerpos, adjuntos, rutas, errores e identificadores aunque un evento futuro los añada', () => {
    const event = {
      type: 'JOB_PROCESSED',
      accountId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      email: 'private@example.invalid',
      body: 'private-body',
      attachments: [{ name: 'private-file' }],
      token: 'sk-private-token',
      error: new Error('private-message'),
      reasonCode: 'private@example.invalid',
      claimed: 3,
      failed: 0,
    };
    const safe = safeOperationalEvent(event);
    expect(safe).toEqual({
      type: 'JOB_PROCESSED',
      claimed: 3,
      failed: 0,
      reasonCode: 'OTHER',
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    logOperationalEvent(event);
    for (const value of ['private', event.accountId, event.jobId])
      expect(output.mock.calls[0][0]).not.toContain(value);
  });
  it('conserva diagnóstico categórico y contadores pero rechaza eventos y valores arbitrarios', () => {
    expect(
      safeOperationalEvent({
        type: 'PROVIDER_FAILED',
        provider: 'openai',
        attempt: 2,
        reasonCode: 'RATE_LIMITED_ATTEMPTS',
      }),
    ).toEqual({
      type: 'PROVIDER_FAILED',
      provider: 'openai',
      attempt: 2,
      reasonCode: 'RATE_LIMITED_ATTEMPTS',
    });
    expect(
      safeOperationalEvent({
        type: 'PRIVATE_CUSTOM_EVENT',
        attempt: 'private',
        failed: NaN,
        claimed: -1,
        delayMs: Infinity,
      }),
    ).toEqual({ type: 'UNKNOWN_EVENT' });
  });
});
