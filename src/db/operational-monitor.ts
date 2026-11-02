import type { DataClient } from './models';
import { DataAccessError } from './errors';
import type { MonitorStore } from '@/modules/observability/monitor';
import type { readObservabilityConfig } from '@/modules/observability/config';

export function createOperationalMonitorStore(
  client: DataClient,
  config: ReturnType<typeof readObservabilityConfig>,
): MonitorStore {
  async function checked<T>(
    operation: PromiseLike<{ data: T; error: unknown }>,
  ): Promise<NonNullable<T>> {
    const result = await operation;
    if (result.error) throw new DataAccessError('UNAVAILABLE');
    return result.data!;
  }
  return {
    check: () =>
      checked(
        client.rpc('check_operational_health', {
          p_window_seconds: config.windowSeconds,
          p_stale_seconds: config.staleSeconds,
          p_repeated_errors: config.repeatedErrors,
        }),
      ),
    active: () =>
      checked(
        client
          .from('operational_alerts')
          .select('*')
          .eq('state', 'OPEN')
          .order('first_seen_at')
          .limit(100),
      ),
    claim: () =>
      checked(client.rpc('claim_operational_alerts', { p_limit: 20 })),
    async finish(id, lease, success) {
      const saved = await checked(
        client.rpc('finish_operational_alert_delivery', {
          p_id: id,
          p_lease: lease,
          p_success: success,
        }),
      );
      if (!saved) throw new DataAccessError('UNAVAILABLE');
    },
    async purge() {
      await checked(
        client.rpc('purge_operational_telemetry', {
          p_days: config.retentionDays,
        }),
      );
    },
  };
}
