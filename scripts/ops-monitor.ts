import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import nextEnvironment from '@next/env';
import { getDataServiceConfig } from '../src/config/env';
import { readObservabilityConfig } from '../src/modules/observability/config';
import { runOperationalMonitor } from '../src/modules/observability/monitor';
import { createOperationalMonitorStore } from '../src/db/operational-monitor';
import { createServiceDataClient } from '../src/db/service-client';
import { startRuntimeHeartbeat } from '../src/modules/operations/runtime-health';

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { once: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(
      'Uso: npm run ops:monitor -- [--once] [--help]\nEjecutar como proceso independiente del worker o con --once desde un planificador externo.\nSin webhook, las alertas quedan en Supabase y en la salida JSON. --once devuelve 1 ante alertas críticas o fallos de entrega.',
    );
    return;
  }
  nextEnvironment.loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== 'production',
    { info() {}, error() {} },
  );
  const config = readObservabilityConfig();
  const store = createOperationalMonitorStore(
    createServiceDataClient(getDataServiceConfig()),
    config,
  );
  const controller = new AbortController(),
    stop = () => controller.abort();
  const stopHeartbeat = startRuntimeHeartbeat('monitor');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const tick = async () => {
    try {
      return await runOperationalMonitor({ store, config });
    } catch {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'ALERT_RAISED',
          executionId: randomUUID(),
          stage: 'MONITOR',
          severity: 'critical',
          alert: 'MONITOR_UNAVAILABLE',
        }),
      );
      return { failed: true };
    }
  };
  try {
    do {
      const result = await tick();
      if (values.once) {
        if (result.failed) process.exitCode = 1;
        break;
      }
      if (controller.signal.aborted) break;
      await new Promise<void>((done) => {
        const finish = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', finish);
          done();
        };
        const timer = setTimeout(finish, config.intervalSeconds * 1000);
        controller.signal.addEventListener('abort', finish, { once: true });
        if (controller.signal.aborted) finish();
      });
    } while (!controller.signal.aborted);
  } finally {
    stopHeartbeat();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      JSON.stringify({
        type: 'ALERT_RAISED',
        stage: 'MONITOR',
        severity: 'critical',
        alert: 'MONITOR_CONFIGURATION_INVALID',
        executionId: randomUUID(),
        timestamp: new Date().toISOString(),
      }),
    );
    process.exitCode = 1;
  });
