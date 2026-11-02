import { runSyncCycle, syncErrorCode, type SyncDependencies } from './sync';
import {
  runEmailJobCycle,
  emailJobErrorCode,
  type EmailJobDependencies,
  type EmailJobConfig,
} from './email-jobs';
import type { SyncConfig } from './sync-config';
import { observe } from '@/modules/observability/telemetry';

export async function runMailWorkerCycle(
  sync: SyncDependencies,
  syncConfig: SyncConfig,
  jobs: EmailJobDependencies,
  jobConfig: EmailJobConfig,
  signal?: AbortSignal,
) {
  let failed: boolean;
  try {
    const result = await observe(
      'SYNC',
      () => runSyncCycle(sync, syncConfig, signal),
      { failed: (value) => value.failed > 0 },
    );
    failed = result.failed > 0;
  } catch (error) {
    sync.report({ type: 'SYNC_CYCLE_FAILED', errorCode: syncErrorCode(error) });
    failed = true;
  }
  try {
    const result = await observe(
      'JOBS',
      () => runEmailJobCycle(jobs, jobConfig, signal),
      { failed: (value) => value.failed > 0 },
    );
    failed = result.failed > 0 || failed;
  } catch (error) {
    jobs.report({
      type: 'JOB_CYCLE_FAILED',
      reasonCode: emailJobErrorCode(error),
    });
    failed = true;
  }
  return { failed };
}
