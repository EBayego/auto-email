import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '@/config/env';
import { readSyncConfig } from './sync-config';

describe('configuración del worker MAIL-029', () => {
  it('usa valores iniciales y un lease mayor que las operaciones de proveedores', () => {
    expect(readSyncConfig({})).toEqual({
      schedulerIntervalSeconds: 30,
      overlapSeconds: 300,
      initialLookbackSeconds: 86400,
      maxAccountsPerCycle: 50,
      maxJobsPerCycle: 50,
      leaseSeconds: 300,
    });
    expect(readSyncConfig({}, 120000).leaseSeconds).toBe(630);
  });
  it('permite ajustar scheduler, solapamiento y carga', () => {
    expect(
      readSyncConfig({
        WORKER_SCHEDULER_INTERVAL_SECONDS: '10',
        WORKER_SYNC_OVERLAP_SECONDS: '600',
        WORKER_INITIAL_LOOKBACK_SECONDS: '3600',
        WORKER_MAX_ACCOUNTS_PER_CYCLE: '5',
      }),
    ).toMatchObject({
      schedulerIntervalSeconds: 10,
      overlapSeconds: 600,
      initialLookbackSeconds: 3600,
      maxAccountsPerCycle: 5,
    });
  });
  it.each(['', '-1', '0', '1.5', 'NaN', ' 30', '301'])(
    'rechaza intervalos inválidos (%s)',
    (value) => {
      expect(() =>
        readSyncConfig({ WORKER_SCHEDULER_INTERVAL_SECONDS: value }),
      ).toThrow(ConfigurationError);
    },
  );
  it('acumula errores sin exponer valores', () => {
    expect(() =>
      readSyncConfig({
        WORKER_SYNC_OVERLAP_SECONDS: 'private',
        WORKER_INITIAL_LOOKBACK_SECONDS: '0',
        WORKER_MAX_ACCOUNTS_PER_CYCLE: '10001',
      }),
    ).toThrow(
      'WORKER_INITIAL_LOOKBACK_SECONDS, WORKER_MAX_ACCOUNTS_PER_CYCLE, WORKER_SYNC_OVERLAP_SECONDS',
    );
  });
});
