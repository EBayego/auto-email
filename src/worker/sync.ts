import { DataAccessError } from '@/db/errors';
import { GmailCredentialError } from '@/modules/gmail/credentials';
import type { GmailClient, GmailMessageReference } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import type { OwnedWorkItem } from './data-access';
import type { SyncConfig } from './sync-config';

export type SyncClaim = OwnedWorkItem &
  Readonly<{
    runId: string;
    windowStartAt: string;
    windowEndAt: string;
  }>;

export interface GmailSyncStore {
  claim(config: SyncConfig): Promise<SyncClaim | null>;
  renew(claim: SyncClaim, leaseSeconds: number): Promise<boolean>;
  recordPage(
    claim: SyncClaim,
    messages: readonly GmailMessageReference[],
  ): Promise<number>;
  finish(claim: SyncClaim, errorCode?: string): Promise<boolean>;
}

export type SyncEvent = Readonly<{
  type: 'SYNC_COMPLETED' | 'SYNC_FAILED' | 'SYNC_CYCLE_FAILED';
  accountId?: string;
  runId?: string;
  messagesDetected?: number;
  errorCode?: string;
}>;
export type SyncDependencies = {
  store: GmailSyncStore;
  gmailFor(work: OwnedWorkItem): Promise<Pick<GmailClient, 'listMessages'>>;
  report(event: SyncEvent): void;
};

export function syncErrorCode(error: unknown): string {
  if (error instanceof ProviderError && error.retryStop)
    return `SYNC_${error.provider.toUpperCase()}_${error.code}_${error.retryStop}`;
  if (
    error instanceof DataAccessError ||
    error instanceof GmailCredentialError ||
    error instanceof ProviderError
  )
    return `SYNC_${error.code}`;
  return 'SYNC_UNAVAILABLE';
}

class SyncError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function synchronize(
  deps: SyncDependencies,
  config: SyncConfig,
  claim: SyncClaim,
  signal?: AbortSignal,
): Promise<boolean> {
  let detected = 0;
  let lost = false;
  let refreshing: Promise<void> | undefined;
  const renew = () => {
    if (!refreshing && !lost)
      refreshing = (async () => {
        try {
          if (!(await deps.store.renew(claim, config.leaseSeconds)))
            lost = true;
        } catch {
          lost = true;
        }
      })().finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };
  const assertLease = async () => {
    await refreshing;
    if (lost) throw new SyncError('SYNC_LEASE_LOST');
  };
  const timer = setInterval(
    () => {
      void renew();
    },
    Math.max(1000, Math.floor((config.leaseSeconds * 1000) / 3)),
  );
  try {
    const gmail = await deps.gmailFor(claim);
    let pageToken: string | undefined;
    const seenTokens = new Set<string>();
    do {
      if (signal?.aborted) throw new SyncError('SYNC_STOPPED');
      await renew();
      await assertLease();
      const page = await gmail.listMessages({
        mailbox: 'incoming',
        after: new Date(claim.windowStartAt),
        before: new Date(claim.windowEndAt),
        maxResults: 100,
        ...(pageToken ? { pageToken } : {}),
      });
      if (signal?.aborted) throw new SyncError('SYNC_STOPPED');
      await assertLease();
      detected += await deps.store.recordPage(claim, page.messages);
      pageToken = page.nextPageToken;
      if (pageToken) {
        if (seenTokens.has(pageToken))
          throw new SyncError('SYNC_INVALID_PAGINATION');
        seenTokens.add(pageToken);
      }
    } while (pageToken);
    await assertLease();
    if (!(await deps.store.finish(claim)))
      throw new SyncError('SYNC_LEASE_LOST');
    deps.report({
      type: 'SYNC_COMPLETED',
      accountId: claim.gmailAccountId,
      runId: claim.runId,
      messagesDetected: detected,
    });
    return true;
  } catch (error) {
    const errorCode =
      error instanceof SyncError ? error.code : syncErrorCode(error);
    // If storage is unavailable or the lease was replaced, the next claim reconciles it.
    try {
      await deps.store.finish(claim, errorCode);
    } catch {
      /* Recover after lease expiration. */
    }
    deps.report({
      type: 'SYNC_FAILED',
      accountId: claim.gmailAccountId,
      runId: claim.runId,
      messagesDetected: detected,
      errorCode,
    });
    return false;
  } finally {
    clearInterval(timer);
    await refreshing;
  }
}

export async function runSyncCycle(
  deps: SyncDependencies,
  config: SyncConfig,
  signal?: AbortSignal,
) {
  const result = { completed: 0, failed: 0 };
  for (let i = 0; i < config.maxAccountsPerCycle && !signal?.aborted; i++) {
    const claim = await deps.store.claim(config);
    if (!claim) break;
    if (await synchronize(deps, config, claim, signal)) result.completed++;
    else result.failed++;
  }
  return result;
}

export async function runSyncWorker(
  deps: SyncDependencies,
  config: SyncConfig,
  signal: AbortSignal,
  cycle: () => Promise<unknown> = () => runSyncCycle(deps, config, signal),
) {
  while (!signal.aborted) {
    try {
      await cycle();
    } catch (error) {
      deps.report({
        type: 'SYNC_CYCLE_FAILED',
        errorCode: syncErrorCode(error),
      });
    }
    if (signal.aborted) break;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, config.schedulerIntervalSeconds * 1000);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
}
