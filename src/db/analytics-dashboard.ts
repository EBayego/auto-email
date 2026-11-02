import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import {
  analyticsQuerySchema,
  analyticsSnapshotSchema,
  type AnalyticsQuery,
} from '@/modules/analytics/dashboard';
export function createAnalyticsRepository(client: DataClient, userId: string) {
  requireUuid(userId);
  return Object.freeze({
    async get(input: AnalyticsQuery = { days: '30' }) {
      const parsed = analyticsQuerySchema.safeParse(input);
      if (!parsed.success) throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client.rpc('get_analytics_dashboard', {
        p_user_id: userId,
        p_days: Number(parsed.data.days),
      });
      if (error)
        throw new DataAccessError(
          error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAVAILABLE',
        );
      const snapshot = analyticsSnapshotSchema.safeParse(data);
      if (!snapshot.success) throw new DataAccessError('UNAVAILABLE');
      return snapshot.data;
    },
  });
}
