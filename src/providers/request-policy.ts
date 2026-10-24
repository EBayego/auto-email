import { performance } from 'node:perf_hooks';
import { ProviderError, type ProviderName } from './errors';

export type RequestLimits = Readonly<{
  maxConcurrent: number;
  accountMaxConcurrent: number;
  requestsPerMinute: number;
  accountRequestsPerMinute: number;
}>;
export type RequestPolicyConfig = Readonly<{
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxElapsedMs: number;
  leaseSeconds: number;
  limits: Readonly<Record<ProviderName, RequestLimits>>;
}>;
export interface ProviderRequestGate {
  acquire(
    provider: ProviderName,
    limits: RequestLimits,
    leaseSeconds: number,
  ): Promise<{ leaseId: string | null; retryAfterMs: number }>;
  release(leaseId: string): Promise<void>;
  cooldown(provider: ProviderName, delayMs: number): Promise<void>;
}
export type ProviderRequestEvent = Readonly<{
  type: 'PROVIDER_RETRY' | 'PROVIDER_WAIT' | 'PROVIDER_FAILED';
  provider: ProviderName;
  accountId?: string;
  attempt: number;
  delayMs?: number;
  reasonCode?: string;
}>;
export type ProviderRequestExecutor = <T>(
  provider: ProviderName,
  retrySafe: boolean,
  operation: (remainingMs?: number) => Promise<T>,
  beforeAcquire?: () => Promise<void>,
) => Promise<T>;
export const directProviderRequest: ProviderRequestExecutor = (
  _provider,
  _safe,
  operation,
  beforeAcquire,
) =>
  Promise.resolve()
    .then(beforeAcquire)
    .then(() => operation());

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const delay = /^\d+(?:\.\d+)?$/.test(value)
    ? Math.ceil(Number(value) * 1000)
    : Date.parse(value) - now;
  return Number.isSafeInteger(delay) && delay >= 0 ? delay : undefined;
}

export function retryDelayMs(
  config: Pick<RequestPolicyConfig, 'baseDelayMs' | 'maxDelayMs'>,
  attempt: number,
  random = Math.random(),
): number {
  const ceiling = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** Math.min(attempt - 1, 30),
  );
  return Math.ceil(ceiling * (0.5 + Math.max(0, Math.min(random, 1)) * 0.5));
}

export function createProviderRequestExecutor(input: {
  gate: ProviderRequestGate;
  config: RequestPolicyConfig;
  signal?: AbortSignal;
  accountId?: string;
  report?: (event: ProviderRequestEvent) => void;
  now?: () => number;
  random?: () => number;
  pause?: (ms: number) => Promise<void>;
}): ProviderRequestExecutor {
  const { gate, config, signal } = input;
  const now = input.now ?? (() => performance.now());
  const random = input.random ?? Math.random;
  const report = (event: ProviderRequestEvent) =>
    input.report?.({
      ...event,
      ...(input.accountId ? { accountId: input.accountId } : {}),
    });
  return async (provider, retrySafe, operation, beforeAcquire) => {
    const started = now();
    let attempt = 0;
    const cancelled = () => {
      if (signal?.aborted) throw new ProviderError(provider, 'CANCELLED');
    };
    const pause = async (ms: number) => {
      cancelled();
      if (input.pause) await input.pause(ms);
      else
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolve();
          };
          const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            reject(new ProviderError(provider, 'CANCELLED'));
          };
          const timer = setTimeout(finish, ms);
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
      cancelled();
    };
    const stopped = (
      error: ProviderError,
      stop: 'ATTEMPTS' | 'TIME' | 'UNSAFE',
    ) => {
      report({
        type: 'PROVIDER_FAILED',
        provider,
        attempt,
        reasonCode: `${error.code}_${stop}`,
      });
      return new ProviderError(provider, error.code, {
        httpStatus: error.httpStatus,
        retryAfterMs: error.retryAfterMs,
        attempts: attempt,
        retryStop: stop,
      });
    };
    for (;;) {
      cancelled();
      if (now() - started >= config.maxElapsedMs)
        throw stopped(
          new ProviderError(provider, 'QUOTA_WAIT_EXHAUSTED'),
          'TIME',
        );
      // Preflight reads need their own permits. Never hold a write permit while
      // doing them: accountMaxConcurrent=1 would otherwise deadlock.
      await beforeAcquire?.();
      cancelled();
      if (now() - started >= config.maxElapsedMs)
        throw stopped(
          new ProviderError(provider, 'QUOTA_WAIT_EXHAUSTED'),
          'TIME',
        );
      const lease = await gate.acquire(
        provider,
        config.limits[provider],
        config.leaseSeconds,
      );
      if (!lease.leaseId) {
        const delay = Math.max(25, Math.ceil(lease.retryAfterMs));
        if (now() - started + delay >= config.maxElapsedMs)
          throw stopped(
            new ProviderError(provider, 'QUOTA_WAIT_EXHAUSTED', {
              retryAfterMs: delay,
            }),
            'TIME',
          );
        report({ type: 'PROVIDER_WAIT', provider, attempt, delayMs: delay });
        await pause(delay);
        continue;
      }
      let failure: unknown;
      let succeeded = false;
      let result: unknown;
      try {
        cancelled();
        const remainingMs = Math.floor(config.maxElapsedMs - (now() - started));
        if (remainingMs <= 0)
          throw stopped(
            new ProviderError(provider, 'QUOTA_WAIT_EXHAUSTED'),
            'TIME',
          );
        attempt++;
        result = await operation(remainingMs);
        succeeded = true;
      } catch (error) {
        failure = error;
      } finally {
        // Releasing a permit cannot authorize replay of an operation that succeeded.
        await gate.release(lease.leaseId).catch(() => {});
      }
      if (succeeded) return result as Awaited<ReturnType<typeof operation>>;
      if (!(failure instanceof ProviderError)) throw failure;
      if (
        failure.code === 'RATE_LIMITED' ||
        failure.retryAfterMs !== undefined
      ) {
        const delay =
          failure.retryAfterMs ?? retryDelayMs(config, attempt, random());
        await gate.cooldown(provider, delay);
      }
      if (!failure.retryable) {
        report({
          type: 'PROVIDER_FAILED',
          provider,
          attempt,
          reasonCode: failure.code,
        });
        throw failure;
      }
      if (!retrySafe) throw stopped(failure, 'UNSAFE');
      if (attempt >= config.maxAttempts) throw stopped(failure, 'ATTEMPTS');
      const backoff = retryDelayMs(config, attempt, random());
      const delay =
        Math.max(backoff, failure.retryAfterMs ?? 0) +
        (failure.retryAfterMs === undefined
          ? 0
          : Math.floor(Math.min(config.baseDelayMs, 1000) * random()));
      if (now() - started + delay >= config.maxElapsedMs)
        throw stopped(failure, 'TIME');
      report({
        type: 'PROVIDER_RETRY',
        provider,
        attempt,
        delayMs: delay,
        reasonCode: failure.code,
      });
      await pause(delay);
    }
  };
}
