import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { stages } from './telemetry';
import type { readObservabilityConfig } from './config';

export const alertKinds = [
  'IMPORTANT_FAILURE',
  'REPEATED_ERRORS',
  'WORKER_FAILURE_RATE',
  'WORKER_STALLED',
  'SYNC_STALE',
  'JOB_STALLED',
] as const;
export const operationalAlertSchema = z.object({
  id: z.uuid(),
  kind: z.enum(alertKinds),
  stage: z.enum(stages),
  severity: z.enum(['warning', 'critical']),
  state: z.enum(['OPEN', 'RESOLVED']),
  affected_count: z.int().nonnegative(),
  run_id: z.uuid().nullable(),
  first_seen_at: z.iso.datetime({ offset: true }),
  delivery_lease: z.uuid().nullable(),
});
export type OperationalAlert = z.infer<typeof operationalAlertSchema>;
export interface MonitorStore {
  check(): Promise<unknown>;
  active(): Promise<unknown[]>;
  claim(): Promise<unknown[]>;
  finish(id: string, lease: string, success: boolean): Promise<void>;
  purge(): Promise<void>;
}
const count = z.int().nonnegative();
const metricsSchema = z.object({
  workerRuns: count,
  workerFailures: count,
  workerFailureRate: z.number().min(0).max(1).nullable(),
  workerAgeSeconds: z.number().nonnegative(),
  staleSyncAccounts: count,
  stalledJobs: count,
  stages: z.array(
    z.object({
      stage: z.enum(stages),
      calls: count,
      failures: count,
      mean_ms: z.number().nonnegative(),
      p95_ms: count,
      usage_known_calls: count,
      input_tokens: count.nullable(),
      output_tokens: count.nullable(),
      priced_calls: count,
      estimated_cost_usd: z.number().nonnegative().nullable(),
    }),
  ),
});
export async function runOperationalMonitor(input: {
  store: MonitorStore;
  config: ReturnType<typeof readObservabilityConfig>;
  fetcher?: typeof fetch;
  log?: (value: Record<string, unknown>) => void;
}) {
  const executionId = randomUUID();
  const logger = input.log ?? ((value) => console.log(JSON.stringify(value)));
  const write = (value: Record<string, unknown>) =>
    logger({ timestamp: new Date().toISOString(), executionId, ...value });
  const metrics = metricsSchema.parse(await input.store.check());
  const active = (await input.store.active()).map((a) =>
    operationalAlertSchema.parse(a),
  );
  write({ type: 'OPERATIONAL_HEALTH', stage: 'MONITOR', ...metrics });
  for (const alert of active)
    write({
      type: 'ALERT_ACTIVE',
      alertId: alert.id,
      kind: alert.kind,
      stage: alert.stage,
      severity: alert.severity,
      affectedCount: alert.affected_count,
      relatedExecutionId: alert.run_id,
    });
  let deliveryFailed = false;
  if (input.config.webhook) {
    for (const raw of await input.store.claim()) {
      const alert = operationalAlertSchema.parse(raw);
      if (!alert.delivery_lease) throw new Error('INVALID_ALERT_LEASE');
      let succeeded = false;
      try {
        const response = await (input.fetcher ?? fetch)(
          input.config.webhook.reveal(),
          {
            method: 'POST',
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.timeout(input.config.webhookTimeoutMs),
            headers: {
              'Content-Type': 'application/json',
              ...(input.config.bearer
                ? { Authorization: `Bearer ${input.config.bearer.reveal()}` }
                : {}),
            },
            body: JSON.stringify({
              version: 1,
              eventId: `${alert.id}:${alert.first_seen_at}`,
              alertId: alert.id,
              kind: alert.kind,
              stage: alert.stage,
              severity: alert.severity,
              affectedCount: alert.affected_count,
              executionId: alert.run_id,
              openedAt: alert.first_seen_at,
            }),
          },
        );
        succeeded = response.ok;
        await response.body?.cancel();
      } catch {
        /* Never log webhook URLs, authorization or response bodies. */
      }
      await input.store.finish(alert.id, alert.delivery_lease, succeeded);
      deliveryFailed ||= !succeeded;
      write({
        type: succeeded ? 'ALERT_DELIVERED' : 'ALERT_DELIVERY_FAILED',
        alertId: alert.id,
        stage: 'MONITOR',
      });
    }
  } else
    write({
      type: 'ALERT_DELIVERY_DISABLED',
      stage: 'MONITOR',
      reasonCode: 'NOT_CONFIGURED',
    });
  await input.store.purge();
  return {
    failed: deliveryFailed || active.some((a) => a.severity === 'critical'),
    activeAlerts: active.length,
  };
}
