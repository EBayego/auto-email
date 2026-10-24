import { runSyncCycle, syncErrorCode, type SyncDependencies } from './sync';
import {
  runEmailJobCycle,
  emailJobErrorCode,
  type EmailJobDependencies,
  type EmailJobConfig,
} from './email-jobs';
import type { SyncConfig } from './sync-config';

export async function runMailWorkerCycle(
  sync: SyncDependencies,
  syncConfig: SyncConfig,
  jobs: EmailJobDependencies,
  jobConfig: EmailJobConfig,
  signal?: AbortSignal,
) {
  let failed: boolean;
  try {
    const result = await runSyncCycle(sync, syncConfig, signal);
    failed = result.failed > 0;
  } catch (error) {
    sync.report({ type: 'SYNC_CYCLE_FAILED', errorCode: syncErrorCode(error) });
    failed = true;
  }
  try {
    const result = await runEmailJobCycle(jobs, jobConfig, signal);
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
