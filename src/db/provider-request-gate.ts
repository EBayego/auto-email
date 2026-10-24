import type { DataClient } from './models';
import { DataAccessError, requireUuid } from './errors';
import type { OwnedWorkItem } from '@/worker/data-access';
import type { ProviderRequestGate } from '@/providers/request-policy';
import { assertExecutionAllowed } from './execution-controls';

export function createProviderRequestGate(
  client: DataClient,
  work?: OwnedWorkItem,
  requireExecution = false,
): ProviderRequestGate {
  if (work) {
    requireUuid(work.userId);
    requireUuid(work.gmailAccountId);
  }
  const scope = work
    ? { p_user_id: work.userId, p_account_id: work.gmailAccountId }
    : {};
  return Object.freeze<ProviderRequestGate>({
    async acquire(provider, limits, leaseSeconds) {
      if (requireExecution && work) await assertExecutionAllowed(client, work);
      const { data, error } = await client.rpc('acquire_provider_request', {
        ...scope,
        p_provider: provider,
        p_lease_seconds: leaseSeconds,
        p_max_concurrent: limits.maxConcurrent,
        p_account_max_concurrent: limits.accountMaxConcurrent,
        p_requests_per_minute: limits.requestsPerMinute,
        p_account_requests_per_minute: limits.accountRequestsPerMinute,
      });
      if (
        error ||
        !data ||
        data.length !== 1 ||
        !Number.isSafeInteger(data[0].retry_after_ms) ||
        data[0].retry_after_ms < 0
      )
        throw new DataAccessError('UNAVAILABLE');
      if (data[0].lease_id) requireUuid(data[0].lease_id);
      if (data[0].lease_id && requireExecution && work) {
        try {
          // Acquiring the shared permit can wait on another transaction. Its
          // original authorization may have changed during that wait.
          await assertExecutionAllowed(client, work);
        } catch (error) {
          try {
            await client.rpc('release_provider_request', {
              ...scope,
              p_lease_id: data[0].lease_id,
            });
          } catch {
            // An unavailable release expires naturally; never run the request.
          }
          throw error;
        }
      }
      return {
        leaseId: data[0].lease_id,
        retryAfterMs: data[0].retry_after_ms,
      };
    },
    async release(leaseId) {
      requireUuid(leaseId);
      const { error } = await client.rpc('release_provider_request', {
        ...scope,
        p_lease_id: leaseId,
      });
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
    async cooldown(provider, delayMs) {
      const { error } = await client.rpc('cooldown_provider_requests', {
        ...scope,
        p_provider: provider,
        p_delay_ms: Math.ceil(delayMs),
      });
      if (error) throw new DataAccessError('UNAVAILABLE');
    },
  });
}
