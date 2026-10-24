import { ConfigurationError } from '@/config/env';

export type SyncConfig = Readonly<{
  schedulerIntervalSeconds: number;
  overlapSeconds: number;
  initialLookbackSeconds: number;
  maxAccountsPerCycle: number;
  maxJobsPerCycle: number;
  leaseSeconds: number;
}>;

export function readSyncConfig(
  env: Record<string, string | undefined> = process.env,
  providerTimeoutMs = 30000,
): SyncConfig {
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
    schedulerIntervalSeconds: integer(
      'WORKER_SCHEDULER_INTERVAL_SECONDS',
      30,
      1,
      300,
    ),
    overlapSeconds: integer('WORKER_SYNC_OVERLAP_SECONDS', 300, 1, 86400),
    initialLookbackSeconds: integer(
      'WORKER_INITIAL_LOOKBACK_SECONDS',
      86400,
      60,
      7776000,
    ),
    maxAccountsPerCycle: integer('WORKER_MAX_ACCOUNTS_PER_CYCLE', 50, 1, 10000),
    maxJobsPerCycle: integer('WORKER_MAX_JOBS_PER_CYCLE', 50, 1, 10000),
    leaseSeconds: Math.max(300, Math.ceil(providerTimeoutMs / 1000) * 5 + 30),
  };
  if (failures.length) throw new ConfigurationError(failures);
  return Object.freeze(config);
}
