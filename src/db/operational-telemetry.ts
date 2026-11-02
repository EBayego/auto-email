import type { DataServiceConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';
import { DataAccessError } from './errors';
import { createTelemetry } from '@/modules/observability/telemetry';
import { readObservabilityConfig } from '@/modules/observability/config';
import type { DataClient } from './models';
import { readGenerationPricing } from '@/modules/analytics/generations';

export function createOperationalTelemetry(
  config: DataServiceConfig,
  client?: DataClient,
) {
  const data =
    client ??
    createServiceDataClient({
      ...config,
      timeoutMs: Math.min(2000, config.timeoutMs),
    });
  readObservabilityConfig();
  const pricing = readGenerationPricing(process.env);
  async function checked(operation: PromiseLike<{ error: unknown }>) {
    if ((await operation).error) throw new DataAccessError('UNAVAILABLE');
  }
  return createTelemetry({
    pricing,
    store: {
      start: (id, stage) =>
        checked(data.from('operational_runs').insert({ id, stage })),
      append: (spans) => checked(data.from('operational_spans').insert(spans)),
      heartbeat: (id) =>
        checked(
          data
            .from('operational_runs')
            .update({ heartbeat_at: new Date().toISOString() })
            .eq('id', id)
            .eq('status', 'RUNNING'),
        ),
      finish: (id, failed, durationMs, spans) =>
        checked(
          data.rpc('finish_operational_run', {
            p_id: id,
            p_failed: failed,
            p_duration_ms: durationMs,
            p_spans: spans,
          }),
        ),
    },
  });
}
