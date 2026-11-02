import { describe, expect, it, vi } from 'vitest';
import {
  createTelemetry,
  observe,
  safeErrorCode,
  type TelemetryStore,
} from './telemetry';
import { telemetryContext } from './context';
import { logOperationalEvent } from '@/modules/security/operational-log';
import { ProviderError } from '@/providers/errors';

function fixture(
  pricing: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  } | null = null,
) {
  const store: TelemetryStore = {
    start: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  const log = vi.fn();
  return { store, log, telemetry: createTelemetry({ store, log, pricing }) };
}
describe('MAIL-066 trazas seguras y métricas', () => {
  it('correlaciona etapas y logs sin exponer los identificadores de una cuenta', async () => {
    const f = fixture(),
      consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    await f.telemetry.run('WORKER', () =>
      observe('SYNC', async () => {
        logOperationalEvent({
          type: 'SYNC_COMPLETED',
          accountId: 'private-account',
          runId: 'private-gmail-run',
          messagesDetected: 2,
        });
        return observe('GMAIL', async () => 'ok');
      }),
    );
    const [run, failed, duration, spans] = vi.mocked(f.store.finish).mock
      .calls[0];
    expect(failed).toBe(false);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(spans.map((s) => s.stage)).toEqual(['GMAIL', 'SYNC', 'WORKER']);
    expect(spans.every((s) => s.run_id === run)).toBe(true);
    expect(JSON.parse(consoleLog.mock.calls[0][0])).toMatchObject({
      executionId: run,
      stage: 'SYNC',
      messagesDetected: 2,
    });
    expect(consoleLog.mock.calls[0][0]).not.toContain('private');
    expect(telemetryContext()).toEqual({});
  });
  it('separa ejecuciones concurrentes y conserva el contexto al resolver promesas', async () => {
    const f = fixture();
    await Promise.all(
      ['WORKER', 'ONBOARDING'].map((stage) =>
        f.telemetry.run(stage as 'WORKER' | 'ONBOARDING', async () => {
          await new Promise((done) => setTimeout(done, 1));
          return observe('OPENAI', async () => 1);
        }),
      ),
    );
    const calls = vi.mocked(f.store.finish).mock.calls;
    expect(new Set(calls.map((c) => c[0])).size).toBe(2);
    expect(
      calls.every(([run, , , spans]) => spans.every((s) => s.run_id === run)),
    ).toBe(true);
  });
  it('registra errores y alerta sin almacenar mensaje, stack, email o credenciales', async () => {
    const f = fixture(),
      error = new ProviderError('google', 'QUOTA_EXCEEDED');
    error.message = 'private@example.invalid Bearer secret';
    await expect(
      f.telemetry.run('WORKER', () =>
        observe('GMAIL', async () => {
          throw error;
        }),
      ),
    ).rejects.toBe(error);
    expect(f.store.finish).toHaveBeenCalledWith(
      expect.any(String),
      true,
      expect.any(Number),
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'GMAIL',
          outcome: 'FAILED',
          reason_code: 'QUOTA_EXCEEDED',
        }),
      ]),
    );
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ALERT_RAISED',
        alert: 'IMPORTANT_FAILURE',
      }),
    );
    expect(JSON.stringify(f.log.mock.calls)).not.toMatch(
      /private|Bearer secret|stack/,
    );
    expect(safeErrorCode({ code: 'PRIVATE_SECRET' })).toBe('OTHER');
  });
  it('trata el resultado failed=true como fallo aunque el worker no lance una excepción', async () => {
    const f = fixture();
    await f.telemetry.run('WORKER', async () => ({ failed: true }), {
      failed: (v) => v.failed,
    });
    expect(vi.mocked(f.store.finish).mock.calls[0][1]).toBe(true);
  });
  it('un fallo de persistencia no repite ni invalida una escritura de Gmail confirmada', async () => {
    const f = fixture(),
      write = vi.fn().mockResolvedValue({ id: 'synthetic-draft' });
    vi.mocked(f.store.start).mockRejectedValue(
      new Error('private-database-error'),
    );
    vi.mocked(f.store.finish).mockRejectedValue(
      new Error('private-database-error'),
    );
    expect(
      await f.telemetry.run('WORKER', () => observe('GMAIL', write)),
    ).toEqual({ id: 'synthetic-draft' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({ alert: 'TELEMETRY_UNAVAILABLE' }),
    );
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(
      'private-database-error',
    );
  });
  it('registra tokens y coste estimado de cada llamada, incluidas las repetidas', async () => {
    const f = fixture({ inputUsdPerMillion: 1.5, outputUsdPerMillion: 6 });
    await f.telemetry.run('WORKER', async () => {
      for (let i = 0; i < 2; i++)
        await observe(
          'OPENAI',
          async () => ({ inputTokens: 100, outputTokens: 10 }),
          { usage: (v) => v },
        );
    });
    const calls = vi
      .mocked(f.store.finish)
      .mock.calls[0][3].filter((s) => s.stage === 'OPENAI');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      input_tokens: 100,
      output_tokens: 10,
      estimated_cost_usd: 0.00021,
    });
  });
  it('mantiene desconocidos los costes y usos no informados, sin sustituirlos por cero', async () => {
    const f = fixture();
    await f.telemetry.run('WORKER', async () => {
      await observe(
        'OPENAI',
        async () => ({ inputTokens: NaN, outputTokens: -1 }),
        { usage: (v) => v },
      );
      await observe('GMAIL', async () => 'synthetic');
    });
    expect(
      vi
        .mocked(f.store.finish)
        .mock.calls[0][3].every(
          (s) =>
            s.input_tokens === null &&
            s.output_tokens === null &&
            s.estimated_cost_usd === null,
        ),
    ).toBe(true);
  });
  it('limita el lote en memoria y señala las métricas que no pudieron conservarse', async () => {
    const f = fixture();
    await f.telemetry.run('WORKER', async () => {
      for (let i = 0; i < 1002; i++) await observe('GMAIL', async () => true);
    });
    expect(vi.mocked(f.store.finish).mock.calls[0][3]).toHaveLength(1000);
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({ alert: 'TELEMETRY_UNAVAILABLE' }),
    );
  });
  it('renueva el heartbeat durante un trabajo largo y detiene el temporizador al terminar', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let done!: () => void;
      const execution = f.telemetry.run(
        'WORKER',
        () =>
          new Promise<void>((resolve) => {
            done = resolve;
          }),
      );
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.store.heartbeat).toHaveBeenCalledTimes(2);
      done();
      await execution;
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.store.heartbeat).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('persiste lotes durante una ejecución grande y conserva todo el consumo sin crecer en memoria', async () => {
    const f = fixture();
    f.store.append = vi.fn().mockResolvedValue(undefined);
    await f.telemetry.run('WORKER', async () => {
      for (let i = 0; i < 1005; i++) await observe('OPENAI', async () => true);
    });
    expect(f.store.append).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(f.store.append)
        .mock.calls.every(([batch]) => batch.length === 500),
    ).toBe(true);
    expect(vi.mocked(f.store.finish).mock.calls[0][3]).toHaveLength(6);
    expect(
      f.log.mock.calls.some(
        ([event]) => event.alert === 'TELEMETRY_UNAVAILABLE',
      ),
    ).toBe(false);
  });
  it('un fallo de un lote de métricas tampoco propaga errores ni repite operaciones', async () => {
    const f = fixture();
    f.store.append = vi.fn().mockRejectedValue(new Error('private-sink-error'));
    const operation = vi.fn().mockResolvedValue(true);
    await f.telemetry.run('WORKER', async () => {
      for (let i = 0; i < 500; i++) await observe('GMAIL', operation);
    });
    expect(operation).toHaveBeenCalledTimes(500);
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({ alert: 'TELEMETRY_UNAVAILABLE' }),
    );
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(
      'private-sink-error',
    );
  });
});
