import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createWorkerRuntime } from '../src/worker/runtime';
import { readSyncConfig } from '../src/worker/sync-config';
import {
  runSyncWorker,
  syncErrorCode,
  type SyncEvent,
} from '../src/worker/sync';
import { runMailWorkerCycle } from '../src/worker/pipeline';
import type { JobEvent } from '../src/worker/email-jobs';
import type { ProviderRequestEvent } from '../src/providers/request-policy';

export const usage = `MAIL-029 — Sincronización periódica de Gmail.
Uso: npm run worker:sync -- [--once] [--help]
  --once   Ejecutar un ciclo y terminar; código 1 si falla alguna cuenta o trabajo.
Consulta cuentas CONNECTED de usuarios ACTIVE con automation_enabled=true
o con una revisión manual solicitada desde /app, sin activar ese ajuste.
La frecuencia por cuenta se configura en user_settings.poll_interval_seconds (300 por defecto).
Variables opcionales:
  WORKER_SCHEDULER_INTERVAL_SECONDS=30
  WORKER_SYNC_OVERLAP_SECONDS=300
  WORKER_INITIAL_LOOKBACK_SECONDS=86400
  WORKER_MAX_ACCOUNTS_PER_CYCLE=50
  WORKER_MAX_JOBS_PER_CYCLE=50
  WORKER_PROVIDER_MAX_ATTEMPTS=3
  WORKER_PROVIDER_BASE_DELAY_MS=1000
  WORKER_PROVIDER_MAX_DELAY_MS=30000
  WORKER_PROVIDER_MAX_ELAPSED_MS=120000
  WORKER_GMAIL_MAX_CONCURRENT=4
  WORKER_OPENAI_MAX_CONCURRENT=2
  WORKER_ACCOUNT_MAX_CONCURRENT=1
  WORKER_GMAIL_REQUESTS_PER_MINUTE=120
  WORKER_GMAIL_ACCOUNT_REQUESTS_PER_MINUTE=60
  WORKER_OPENAI_REQUESTS_PER_MINUTE=30
  WORKER_OPENAI_ACCOUNT_REQUESTS_PER_MINUTE=10
Cada ciclo sincroniza, clasifica y prepara borradores para REPLY_REQUIRED,
con perfil confirmado, validación factual y políticas vigentes. Reconcilia
las creaciones inciertas sin repetir escrituras ni modificar borradores existentes.
Antes de clasificar comprueba borradores y respuestas existentes en Gmail.
Solo registra IDs y contadores. Ctrl+C termina el ciclo de forma segura.`;

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { once: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  nextEnvironment.loadEnvConfig(
    process.cwd(),
    process.env.NODE_ENV !== 'production',
    { info() {}, error() {} },
  );
  const config = getServerConfig();
  const syncConfig = readSyncConfig(process.env, config.timeoutMs);
  const controller = new AbortController();
  const report = (event: SyncEvent | JobEvent | ProviderRequestEvent) =>
    console.log(JSON.stringify(event));
  const runtime = createWorkerRuntime(config, undefined, {
    signal: controller.signal,
    report,
    enforceExecution: true,
  });
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const deps = {
    store: runtime.syncStore,
    gmailFor: runtime.gmailFor,
    report,
  };
  const jobs = {
    store: runtime.jobStore,
    inspect: runtime.inspectEmailJob,
    classifierFor: runtime.classifierFor,
    generate: runtime.generateEmailJob,
    reconcileDrafts: runtime.reconcileDrafts,
    report: deps.report,
  };
  const cycle = async () => {
    const result = await runMailWorkerCycle(
      deps,
      syncConfig,
      jobs,
      {
        leaseSeconds: syncConfig.leaseSeconds,
        maxJobsPerCycle: syncConfig.maxJobsPerCycle,
      },
      controller.signal,
    );
    console.log(JSON.stringify({ type: 'WORKER_CYCLE_COMPLETED', ...result }));
    return result;
  };
  try {
    if (values.once) {
      const result = await cycle();
      if (result.failed) process.exitCode = 1;
    } else await runSyncWorker(deps, syncConfig, controller.signal, cycle);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof ConfigurationError
        ? error.message
        : syncErrorCode(error),
    );
    process.exitCode = 1;
  });
}
