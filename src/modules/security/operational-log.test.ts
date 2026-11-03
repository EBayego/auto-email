import { describe, expect, it, vi } from 'vitest';
import { safeOperationalEvent, logOperationalEvent } from './operational-log';
describe('MAIL-062 logs operativos sin datos personales', () => {
  it('registra fallos de Microsoft sin códigos OAuth ni respuestas privadas', () => {
    expect(
      safeOperationalEvent({
        type: 'MICROSOFT_CONNECTION_FAILED',
        reasonCode: 'MICROSOFT_IDENTITY_REJECTED',
        token: 'private-token',
        code: 'private-code',
        error: new Error('private-provider-response'),
      }),
    ).toEqual({
      type: 'MICROSOFT_CONNECTION_FAILED',
      reasonCode: 'MICROSOFT_IDENTITY_REJECTED',
    });
  });
  it('conserva la fase del análisis y rechaza fases o campos arbitrarios', () => {
    expect(
      safeOperationalEvent({
        type: 'ONBOARDING_FAILED',
        phase: 'SAMPLING',
        scanned: 37,
        selected: 0,
        errorCode: 'DATABASE_UNAVAILABLE',
        body: 'private-body',
      }),
    ).toEqual({
      type: 'ONBOARDING_FAILED',
      phase: 'SAMPLING',
      scanned: 37,
      selected: 0,
      errorCode: 'DATABASE_UNAVAILABLE',
    });
    expect(
      safeOperationalEvent({
        type: 'ONBOARDING_FAILED',
        phase: 'private-data',
      }),
    ).toEqual({ type: 'ONBOARDING_FAILED' });
    expect(
      safeOperationalEvent({ type: 'JOB_PROCESSED', phase: 'SAMPLING' }),
    ).toEqual({ type: 'JOB_PROCESSED' });
  });
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
