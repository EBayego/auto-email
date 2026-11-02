import { parseArgs } from 'node:util';
import { runSharePointCycle } from '../src/worker/sharepoint';
import { createServiceDataClient } from '../src/db/service-client';
import { logOperationalEvent } from '../src/modules/security/operational-log';
import { createOperationalTelemetry } from '../src/db/operational-telemetry';
import { randomUUID } from 'node:crypto';
import { startRuntimeHeartbeat } from '../src/modules/operations/runtime-health';
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
import type { OnboardingEvent } from '../src/worker/onboarding';
import type { SentTrackingEvent } from '../src/worker/sent-draft-tracking';
import type { ReplyComparisonEvent } from '../src/worker/reply-comparisons';

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
Solo registra tipos, motivos y contadores; nunca identificadores personales. Ctrl+C termina el ciclo de forma segura.`;

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
  const telemetry = createOperationalTelemetry(config);
  const syncConfig = readSyncConfig(process.env, config.timeoutMs);
  const controller = new AbortController();
  const report = (
    event:
      | SyncEvent
      | JobEvent
      | ProviderRequestEvent
      | OnboardingEvent
      | SentTrackingEvent
      | ReplyComparisonEvent,
  ) => logOperationalEvent(event);
  const runtime = createWorkerRuntime(config, undefined, {
    signal: controller.signal,
    report,
    enforceExecution: true,
  });
  const stop = () => controller.abort();
  const stopHeartbeat = startRuntimeHeartbeat('worker');
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
  const onboardingCycle = () =>
    telemetry.run(
      'ONBOARDING',
      async () => {
        try {
          return await runtime.runOnboarding();
        } catch {
          logOperationalEvent({
            type: 'ONBOARDING_FAILED',
            reasonCode: 'UNAVAILABLE',
          });
          return { failed: true };
        }
      },
      { failed: (value) => value.failed },
    );
  const deletionCycle = () =>
    telemetry.run(
      'DELETION',
      async () => {
        try {
          return await runtime.runAccountDeletions({
            signal: controller.signal,
            report: logOperationalEvent,
          });
        } catch {
          logOperationalEvent({
            type: 'ACCOUNT_DELETION_RETRY',
            reasonCode: 'UNAVAILABLE',
          });
          return { failed: true };
        }
      },
      { failed: (value) => value.failed },
    );
  const cycle = () =>
    telemetry.run(
      'WORKER',
      async () => {
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
        logOperationalEvent({ type: 'WORKER_CYCLE_COMPLETED', ...result });
        return result;
      },
      { failed: (value) => value.failed },
    );
  const sharePointCycle = () =>
    telemetry.run(
      'KNOWLEDGE',
      () =>
        runSharePointCycle(createServiceDataClient(config), controller.signal),
      { failed: (value) => value.failed },
    );
  try {
    if (values.once) {
      const results = await Promise.all([
        cycle(),
        onboardingCycle(),
        deletionCycle(),
        sharePointCycle(),
      ]);
      if (results.some((result) => result.failed)) process.exitCode = 1;
    } else
      await Promise.all([
        runSyncWorker(deps, syncConfig, controller.signal, cycle),
        runSyncWorker(deps, syncConfig, controller.signal, onboardingCycle),
        runSyncWorker(deps, syncConfig, controller.signal, deletionCycle),
        runSyncWorker(deps, syncConfig, controller.signal, sharePointCycle),
      ]);
  } finally {
    stopHeartbeat();
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
      JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'ALERT_RAISED',
        executionId: randomUUID(),
        stage: 'WORKER',
        severity: 'critical',
        alert: 'WORKER_STARTUP_FAILED',
        reasonCode:
          error instanceof ConfigurationError
            ? 'CONFIGURATION_INVALID'
            : syncErrorCode(error),
      }),
    );
    process.exitCode = 1;
  });
}
