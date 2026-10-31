import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import {
  activityFeedSchema,
  activityDetailSchema,
  activityQuerySchema,
  type ActivityQuery,
  type ActivityFeed,
} from '@/modules/workflow/activity';
function failed(error: { message?: string } | null) {
  if (error)
    throw new DataAccessError(
      error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNAVAILABLE',
    );
}
export function createActivityRepository(client: DataClient, userId: string) {
  requireUuid(userId);
  return Object.freeze({
    async feed(
      input: ActivityQuery = { status: 'ALL' },
    ): Promise<ActivityFeed> {
      const query = activityQuerySchema.safeParse(input);
      if (!query.success) throw new DataAccessError('INVALID_INPUT');
      const { data, error } = await client.rpc('get_activity_feed', {
        p_user_id: userId,
        p_status: query.data.status,
        p_before: query.data.before,
        p_before_id: query.data.beforeId,
        p_limit: 20,
      });
      failed(error);
      const parsed = activityFeedSchema.safeParse(data);
      if (!parsed.success) throw new DataAccessError('UNAVAILABLE');
      const jobs = parsed.data.jobs.slice(0, 20),
        last = jobs.at(-1);
      return {
        ...parsed.data,
        jobs,
        nextCursor:
          parsed.data.jobs.length > 20 && last
            ? { before: last.createdAt, beforeId: last.id }
            : null,
      };
    },
    async detail(jobId: string) {
      requireUuid(jobId);
      const { data, error } = await client.rpc('get_activity_detail', {
        p_user_id: userId,
        p_job_id: jobId,
      });
      failed(error);
      if (data === null) throw new DataAccessError('NOT_FOUND');
      const parsed = activityDetailSchema.safeParse(data);
      if (!parsed.success) throw new DataAccessError('UNAVAILABLE');
      return parsed.data;
    },
  });
}
