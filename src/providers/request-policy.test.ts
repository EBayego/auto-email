import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretValue } from '@/config/env';
import { readRequestPolicyConfig } from '@/worker/request-config';
import { createGmailClient } from './gmail';
import { createOpenAiClient } from './openai';
import { ProviderError } from './errors';
import { createResponseGenerator } from '@/modules/response/generator';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from '../../tests/fixtures/responses';
import {
  createProviderRequestExecutor,
  parseRetryAfter,
  retryDelayMs,
  type ProviderRequestGate,
} from './request-policy';

function fixture(
  extra: Partial<ReturnType<typeof readRequestPolicyConfig>> = {},
) {
  let elapsed = 0;
  const gate = {
    acquire: vi
      .fn<ProviderRequestGate['acquire']>()
      .mockResolvedValue({ leaseId: 'lease33', retryAfterMs: 0 }),
    release: vi.fn<ProviderRequestGate['release']>().mockResolvedValue(),
    cooldown: vi.fn<ProviderRequestGate['cooldown']>().mockResolvedValue(),
  };
  const pause = vi.fn(async (ms: number) => {
    elapsed += ms;
  });
  const report = vi.fn();
  const config = { ...readRequestPolicyConfig({}), ...extra };
  const execute = createProviderRequestExecutor({
    gate,
    config,
    now: () => elapsed,
    pause,
    random: () => 1,
    report,
  });
  return { gate, pause, report, config, execute };
}
afterEach(() => vi.useRealTimers());
describe('MAIL-033 política de peticiones', () => {
  it('EPIC-07 accepts recovery from two HTTP failures while keeping independent verification and actual request counts', async () => {
    const f = fixture();
    let requests = 0;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (++requests <= 2)
        return Response.json(
          { error: { type: 'server_error', message: 'Temporary failure' } },
          { status: 503 },
        );
      const payload = JSON.parse(String(init?.body));
      expect(payload.tool_choice).toBe('none');
      const text = JSON.stringify(
        payload.text.format.name === 'response_verification_v1'
          ? supportedResponse()
          : readyResponse(),
      );
      return Response.json({
        id: `resp_${requests}`,
        object: 'response',
        status: 'completed',
        output: [
          {
            id: `msg_${requests}`,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 3 },
      });
    });
    const ai = createOpenAiClient(
      {
        apiKey: new SecretValue('synthetic-key'),
        model: 'synthetic-model',
        reasoningEffort: 'none',
        maxOutputTokens: 2048,
      },
      30000,
      fetcher,
      f.execute,
    );
    const result = await createResponseGenerator(ai).generate(responseInput());
    expect(result).toMatchObject({
      status: 'READY',
      modelCalls: 4,
      inputTokens: 10,
      outputTokens: 6,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(
      JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body)).text.format.name,
    ).toBe('response_verification_v1');
    expect(f.gate.release).toHaveBeenCalledTimes(4);
  });
  it('reintenta 5xx con backoff exponencial, liberando el permiso entre intentos', async () => {
    const f = fixture();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('google', 'UNAVAILABLE'))
      .mockRejectedValueOnce(new ProviderError('google', 'UNAVAILABLE'))
      .mockResolvedValue('ok');
    expect(await f.execute('google', true, operation)).toBe('ok');
    expect(f.pause.mock.calls).toEqual([[1000], [2000]]);
    expect(f.gate.acquire).toHaveBeenCalledTimes(3);
    expect(f.gate.release).toHaveBeenCalledTimes(3);
    expect(f.gate.release.mock.invocationCallOrder[0]).toBeLessThan(
      f.pause.mock.invocationCallOrder[0],
    );
  });
  it('finaliza al agotar el número de intentos y conserva el motivo categórico', async () => {
    const f = fixture();
    const operation = vi
      .fn()
      .mockRejectedValue(
        new ProviderError('openai', 'RATE_LIMITED', { retryAfterMs: 1000 }),
      );
    await expect(f.execute('openai', true, operation)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryStop: 'ATTEMPTS',
      attempts: 3,
    });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(f.gate.cooldown).toHaveBeenCalledTimes(3);
    expect(f.report).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PROVIDER_FAILED',
        reasonCode: 'RATE_LIMITED_ATTEMPTS',
      }),
    );
  });
  it('respeta Retry-After aunque supere el backoff máximo', async () => {
    const f = fixture();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        new ProviderError('openai', 'RATE_LIMITED', { retryAfterMs: 45000 }),
      )
      .mockResolvedValue('ok');
    await f.execute('openai', true, operation);
    expect(f.pause).toHaveBeenCalledExactlyOnceWith(46000);
    expect(f.gate.cooldown).toHaveBeenCalledWith('openai', 45000);
  });
  it('no acorta una espera del proveedor que excede el presupuesto total', async () => {
    const f = fixture({ maxElapsedMs: 10000 });
    const operation = vi
      .fn()
      .mockRejectedValue(
        new ProviderError('google', 'RATE_LIMITED', { retryAfterMs: 60000 }),
      );
    await expect(f.execute('google', true, operation)).rejects.toMatchObject({
      retryStop: 'TIME',
      attempts: 1,
      retryAfterMs: 60000,
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(f.pause).not.toHaveBeenCalled();
    expect(f.gate.cooldown).toHaveBeenCalledWith('google', 60000);
  });
  it.each([
    'QUOTA_EXCEEDED',
    'PERMISSION_DENIED',
    'NOT_FOUND',
    'INVALID_RESPONSE',
    'AUTHENTICATION_FAILED',
  ] as const)('no reintenta el error definitivo %s', async (code) => {
    const f = fixture();
    const operation = vi
      .fn()
      .mockRejectedValue(new ProviderError('google', code));
    await expect(f.execute('google', true, operation)).rejects.toMatchObject({
      code,
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(f.pause).not.toHaveBeenCalled();
  });
  it('nunca repite una escritura de Gmail con resultado desconocido', async () => {
    const f = fixture();
    const operation = vi
      .fn()
      .mockRejectedValue(new ProviderError('google', 'UNAVAILABLE'));
    await expect(f.execute('google', false, operation)).rejects.toMatchObject({
      retryStop: 'UNSAFE',
      attempts: 1,
    });
    expect(operation).toHaveBeenCalledOnce();
  });
  it('espera un permiso sin consumir intentos de red', async () => {
    const f = fixture();
    f.gate.acquire.mockResolvedValueOnce({ leaseId: null, retryAfterMs: 250 });
    const operation = vi.fn().mockResolvedValue(7);
    expect(await f.execute('google', true, operation)).toBe(7);
    expect(operation).toHaveBeenCalledOnce();
    expect(f.pause).toHaveBeenCalledExactlyOnceWith(250);
  });
  it('limita también el tiempo de espera de cuotas', async () => {
    const f = fixture({ maxElapsedMs: 1000 });
    f.gate.acquire.mockResolvedValue({ leaseId: null, retryAfterMs: 60000 });
    const operation = vi.fn();
    await expect(f.execute('google', true, operation)).rejects.toMatchObject({
      code: 'QUOTA_WAIT_EXHAUSTED',
      retryStop: 'TIME',
      attempts: 0,
    });
    expect(operation).not.toHaveBeenCalled();
  });
  it('una caída de almacenamiento no permite saltarse la cuota', async () => {
    const f = fixture();
    f.gate.acquire.mockRejectedValue(new Error('storage'));
    const operation = vi.fn();
    await expect(f.execute('google', true, operation)).rejects.toThrow(
      'storage',
    );
    expect(operation).not.toHaveBeenCalled();
  });
  it('un fallo al liberar el permiso no repite una operación completada', async () => {
    const f = fixture();
    f.gate.release.mockRejectedValue(new Error('storage'));
    const operation = vi.fn().mockResolvedValue('created');
    expect(await f.execute('google', false, operation)).toBe('created');
    expect(operation).toHaveBeenCalledOnce();
  });
  it('reduce el timeout disponible después de esperar', async () => {
    const f = fixture();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('google', 'UNAVAILABLE'))
      .mockResolvedValue('ok');
    await f.execute('google', true, operation);
    expect(operation.mock.calls).toEqual([[120000], [119000]]);
  });
  it('cancela una espera y limpia el temporizador', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.gate.acquire.mockResolvedValue({ leaseId: null, retryAfterMs: 1000 });
    const controller = new AbortController();
    const execute = createProviderRequestExecutor({
      gate: f.gate,
      config: f.config,
      signal: controller.signal,
    });
    const operation = vi.fn();
    const running = expect(
      execute('google', true, operation),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await running;
    expect(operation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('calcula jitter acotado y saturación del backoff', () => {
    expect(retryDelayMs({ baseDelayMs: 1000, maxDelayMs: 3000 }, 1, 0)).toBe(
      500,
    );
    expect(retryDelayMs({ baseDelayMs: 1000, maxDelayMs: 3000 }, 2, 1)).toBe(
      2000,
    );
    expect(retryDelayMs({ baseDelayMs: 1000, maxDelayMs: 3000 }, 20, 1)).toBe(
      3000,
    );
  });
  it('interpreta Retry-After en segundos o fecha y descarta valores inválidos', () => {
    expect(parseRetryAfter('1.5')).toBe(1500);
    expect(
      parseRetryAfter(
        'Wed, 21 Oct 2026 18:00:03 GMT',
        Date.parse('2026-10-21T18:00:00Z'),
      ),
    ).toBe(3000);
    expect(parseRetryAfter('invalid')).toBeUndefined();
    expect(parseRetryAfter('-1')).toBeUndefined();
  });
  it('aplica la política a cada GET de Gmail pero nunca reenvía drafts.create', async () => {
    const f = fixture();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ id: 'message33', threadId: 'thread33' }),
      );
    const gmail = createGmailClient(
      async () => 'synthetic-token',
      30000,
      fetcher,
      f.execute,
    );
    expect(await gmail.getMessage('message33')).toMatchObject({
      id: 'message33',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockReset().mockResolvedValue(Response.json({}, { status: 503 }));
    await expect(
      gmail.createDraft({ raw: 'dGVzdA', threadId: 'thread33' }),
    ).rejects.toMatchObject({ retryStop: 'UNSAFE' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('no duplica los reintentos del SDK de OpenAI y distingue límites de facturación', async () => {
    const f = fixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json(
        {
          error: {
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            message: 'private',
          },
        },
        { status: 429, headers: { 'retry-after': '1' } },
      ),
    );
    const ai = createOpenAiClient(
      {
        apiKey: new SecretValue('synthetic-key'),
        model: 'synthetic-model',
        reasoningEffort: 'none',
        maxOutputTokens: 2048,
      },
      30000,
      fetcher,
      f.execute,
    );
    await expect(
      ai.generate({ input: 'synthetic', instructions: 'synthetic' }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      attempts: 3,
      retryStop: 'ATTEMPTS',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockReset().mockImplementation(async () =>
      Response.json(
        {
          error: {
            type: 'insufficient_quota',
            code: 'insufficient_quota',
            message: 'private',
          },
        },
        { status: 429 },
      ),
    );
    await expect(
      ai.generate({ input: 'synthetic', instructions: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.report.mock.calls)).not.toContain('private');
    fetcher
      .mockReset()
      .mockImplementation(async () =>
        Response.json(
          { error: { type: 'insufficient_quota', message: 'private' } },
          { status: 429 },
        ),
      );
    await expect(
      ai.generate({ input: 'synthetic', instructions: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', retryable: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
