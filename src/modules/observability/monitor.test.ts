import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runOperationalMonitor, type MonitorStore } from './monitor';
import { readObservabilityConfig } from './config';
import { assertNoPublicSecrets } from '@/config/env';
import { main } from '../../../scripts/ops-monitor';

function fixture(webhook = false) {
  const alert = {
    id: randomUUID(),
    kind: 'IMPORTANT_FAILURE',
    stage: 'WORKER',
    severity: 'critical',
    state: 'OPEN',
    affected_count: 1,
    run_id: randomUUID(),
    first_seen_at: new Date().toISOString(),
    delivery_lease: randomUUID(),
    email: 'private@example.invalid',
    bodyText: 'private email',
  };
  const store: MonitorStore = {
    check: vi.fn().mockResolvedValue({
      workerRuns: 1,
      workerFailures: 1,
      workerFailureRate: 1,
      workerAgeSeconds: 1,
      staleSyncAccounts: 0,
      stalledJobs: 0,
      stages: [],
      privateData: 'private-email',
    }),
    active: vi.fn().mockResolvedValue([alert]),
    claim: vi.fn().mockResolvedValue([alert]),
    finish: vi.fn().mockResolvedValue(undefined),
    purge: vi.fn().mockResolvedValue(undefined),
  };
  return {
    store,
    log: vi.fn(),
    fetcher: vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 })),
    config: readObservabilityConfig(
      webhook
        ? {
            ALERT_WEBHOOK_URL: 'https://monitor.example.invalid/secret-path',
            ALERT_WEBHOOK_BEARER_TOKEN: 'synthetic-secret',
          }
        : {},
    ),
    alert,
  };
}
describe('MAIL-066 monitor y entrega de alertas', () => {
  it('sin destino conserva la alerta y evita consumir su lease de entrega', async () => {
    const f = fixture();
    expect(await runOperationalMonitor(f)).toMatchObject({
      failed: true,
      activeAlerts: 1,
    });
    expect(f.store.claim).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.store.purge).toHaveBeenCalled();
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('private');
    const executions = f.log.mock.calls.map(([event]) => event.executionId);
    expect(new Set(executions).size).toBe(1);
    expect(executions[0]).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('entrega solo metadatos permitidos con un identificador estable, sin seguir redirecciones', async () => {
    const f = fixture(true);
    await runOperationalMonitor(f);
    const [url, init] = f.fetcher.mock.calls[0];
    expect(url).toBe(f.config.webhook!.reveal());
    expect(init).toMatchObject({
      redirect: 'error',
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-secret' },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      eventId: `${f.alert.id}:${f.alert.first_seen_at}`,
      executionId: f.alert.run_id,
    });
    expect(String(init?.body)).not.toContain('private');
    expect(f.store.finish).toHaveBeenCalledWith(
      f.alert.id,
      f.alert.delivery_lease,
      true,
    );
    expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/secret|private/);
  });
  it.each(['network', 'http', 'redirect'])(
    'un fallo %s conserva el incidente para un reintento controlado',
    async (failure) => {
      const f = fixture(true);
      if (failure === 'network')
        f.fetcher.mockRejectedValue(new Error('private webhook error'));
      else
        f.fetcher.mockResolvedValue(
          new Response('private response', {
            status: failure === 'http' ? 503 : 302,
          }),
        );
      expect((await runOperationalMonitor(f)).failed).toBe(true);
      expect(f.store.finish).toHaveBeenCalledWith(
        f.alert.id,
        f.alert.delivery_lease,
        false,
      );
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(f.log.mock.calls)).not.toContain('private');
    },
  );
  it('un registro corrupto se rechaza antes de llegar al destino de alertas', async () => {
    const f = fixture(true);
    vi.mocked(f.store.claim).mockResolvedValue([
      { ...f.alert, stage: 'private-stage' },
    ]);
    await expect(runOperationalMonitor(f)).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('no convierte un periodo vacío en una tasa de fallos cero', async () => {
    const f = fixture();
    vi.mocked(f.store.active).mockResolvedValue([]);
    vi.mocked(f.store.check).mockResolvedValue({
      workerRuns: 0,
      workerFailures: 0,
      workerFailureRate: null,
      workerAgeSeconds: 0,
      staleSyncAccounts: 0,
      stalledJobs: 0,
      stages: [],
    });
    expect((await runOperationalMonitor(f)).failed).toBe(false);
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({ workerFailureRate: null }),
    );
  });
  it('la ayuda explica la ejecución independiente sin necesitar credenciales', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(output).toHaveBeenCalledWith(
      expect.stringContaining('proceso independiente'),
    );
    await expect(main(['--unknown'])).rejects.toThrow();
  });
});
describe('configuración de observabilidad', () => {
  it.each([
    'http://example.invalid',
    'https://user:secret@example.invalid',
    'https://localhost/alert',
    'https://example.invalid/#secret',
  ])('rechaza el destino %s', (ALERT_WEBHOOK_URL) =>
    expect(() => readObservabilityConfig({ ALERT_WEBHOOK_URL })).toThrow(
      'ALERT_WEBHOOK_URL',
    ),
  );
  it.each(['0', '-1', 'NaN', '1.5', '86401'])(
    'rechaza un intervalo inválido %s',
    (value) =>
      expect(() =>
        readObservabilityConfig({ OBSERVABILITY_STALE_SECONDS: value }),
      ).toThrow('OBSERVABILITY_STALE_SECONDS'),
  );
  it('protege el destino y la autorización en inspecciones y variables públicas', () => {
    const config = readObservabilityConfig({
      ALERT_WEBHOOK_URL: 'https://example.invalid/secret',
      ALERT_WEBHOOK_BEARER_TOKEN: 'secret-token',
    });
    expect(JSON.stringify(config)).not.toContain('secret');
    expect(() =>
      assertNoPublicSecrets({ NEXT_PUBLIC_ALERT_WEBHOOK_URL: 'secret' }),
    ).toThrow();
    expect(() =>
      readObservabilityConfig({ ALERT_WEBHOOK_BEARER_TOKEN: 'secret' }),
    ).toThrow();
  });
});
