import { ConfigurationError } from '@/config/env';
import type { RequestPolicyConfig } from '@/providers/request-policy';

export function readRequestPolicyConfig(
  env: Record<string, string | undefined> = process.env,
  timeoutMs = 30000,
): RequestPolicyConfig {
  const failures: string[] = [];
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const raw = env[name];
    const value = raw === undefined ? fallback : Number(raw);
    if (
      (raw !== undefined && !/^\d+$/.test(raw)) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      failures.push(name);
    return value;
  };
  const config = {
    maxAttempts: integer('WORKER_PROVIDER_MAX_ATTEMPTS', 3, 1, 5),
    baseDelayMs: integer('WORKER_PROVIDER_BASE_DELAY_MS', 1000, 100, 30000),
    maxDelayMs: integer('WORKER_PROVIDER_MAX_DELAY_MS', 30000, 100, 60000),
    maxElapsedMs: integer(
      'WORKER_PROVIDER_MAX_ELAPSED_MS',
      120000,
      1000,
      240000,
    ),
    leaseSeconds: Math.ceil(timeoutMs / 1000) + 10,
    limits: {
      google: {
        maxConcurrent: integer('WORKER_GMAIL_MAX_CONCURRENT', 4, 1, 100),
        accountMaxConcurrent: integer(
          'WORKER_ACCOUNT_MAX_CONCURRENT',
          1,
          1,
          10,
        ),
        requestsPerMinute: integer(
          'WORKER_GMAIL_REQUESTS_PER_MINUTE',
          120,
          1,
          10000,
        ),
        accountRequestsPerMinute: integer(
          'WORKER_GMAIL_ACCOUNT_REQUESTS_PER_MINUTE',
          60,
          1,
          1000,
        ),
      },
      openai: {
        maxConcurrent: integer('WORKER_OPENAI_MAX_CONCURRENT', 2, 1, 100),
        accountMaxConcurrent: integer(
          'WORKER_ACCOUNT_MAX_CONCURRENT',
          1,
          1,
          10,
        ),
        requestsPerMinute: integer(
          'WORKER_OPENAI_REQUESTS_PER_MINUTE',
          30,
          1,
          10000,
        ),
        accountRequestsPerMinute: integer(
          'WORKER_OPENAI_ACCOUNT_REQUESTS_PER_MINUTE',
          10,
          1,
          1000,
        ),
      },
    },
  };
  if (config.baseDelayMs > config.maxDelayMs)
    failures.push('WORKER_PROVIDER_MAX_DELAY_MS');
  if (failures.length) throw new ConfigurationError([...new Set(failures)]);
  return Object.freeze(config);
}
