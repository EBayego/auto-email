import { describe, expect, it, vi } from 'vitest';
import { runMailWorkerCycle } from './pipeline';
import { readSyncConfig } from './sync-config';
import type { SyncDependencies } from './sync';
import type { EmailJobDependencies } from './email-jobs';

describe('MAIL-031 integración de ciclos', () => {
  it('procesa trabajos pendientes incluso si la consulta de novedades falla', async () => {
    const sync = {
      store: { claim: vi.fn().mockRejectedValue(new Error('private')) },
      report: vi.fn(),
    } as unknown as SyncDependencies;
    const jobs = {
      store: {
        recover: vi.fn().mockResolvedValue(0),
        claim: vi.fn().mockResolvedValue(null),
      },
      report: vi.fn(),
    } as unknown as EmailJobDependencies;
    expect(
      await runMailWorkerCycle(sync, readSyncConfig({}), jobs, {
        leaseSeconds: 300,
        maxJobsPerCycle: 10,
      }),
    ).toEqual({ failed: true });
    expect(jobs.store.claim).toHaveBeenCalledOnce();
    expect(sync.report).toHaveBeenCalledWith({
      type: 'SYNC_CYCLE_FAILED',
      errorCode: 'SYNC_UNAVAILABLE',
    });
  });
});
