import { DataAccessError, requireResource, requireUuid } from './errors';
import type {
  DataClient,
  GmailAccount,
  ProcessingRun,
  RunOutcome,
  RunTrigger,
  UserProfile,
  UserSettings,
} from './models';

const accountColumns = 'id, user_id, email, status, scope_set, last_sync_at';
const runColumns =
  'id, user_id, gmail_account_id, trigger_kind, status, started_at, finished_at, messages_detected, messages_processed, drafts_created, error_count, error_code';

async function checked<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T | null> {
  try {
    const result = await query;
    if (result.error) throw new DataAccessError('UNAVAILABLE');
    return result.data;
  } catch {
    throw new DataAccessError('UNAVAILABLE');
  }
}

function owned<T extends { user_id: string }>(
  row: T | null,
  ownerId: string,
): T | null {
  if (row && row.user_id !== ownerId) throw new DataAccessError('UNAVAILABLE');
  return row;
}

function validateOutcome(outcome: RunOutcome) {
  if (
    !outcome ||
    !['COMPLETED', 'CANCELLED', 'FAILED'].includes(outcome.status) ||
    ![
      outcome.messagesDetected,
      outcome.messagesProcessed,
      outcome.draftsCreated,
      outcome.errorCount,
    ].every((n) => Number.isInteger(n) && n >= 0 && n <= 2147483647) ||
    outcome.messagesProcessed > outcome.messagesDetected ||
    outcome.draftsCreated > outcome.messagesProcessed ||
    (outcome.status === 'FAILED' && !outcome.errorCode) ||
    (outcome.errorCode !== undefined &&
      (typeof outcome.errorCode !== 'string' ||
        !/^[A-Z][A-Z0-9_]{0,63}$/.test(outcome.errorCode)))
  ) {
    throw new DataAccessError('INVALID_INPUT');
  }
}

export function createOwnerRepositories(client: DataClient, ownerId: string) {
  requireUuid(ownerId);

  const users = Object.freeze({
    async get(): Promise<UserProfile | null> {
      const row = await checked<UserProfile>(
        client
          .from('users')
          .select('id, status')
          .eq('id', ownerId)
          .maybeSingle(),
      );
      if (row && row.id !== ownerId) throw new DataAccessError('UNAVAILABLE');
      return row;
    },
  });

  const settings = Object.freeze({
    async get(): Promise<UserSettings> {
      return requireResource(
        owned(
          await checked<UserSettings>(
            client
              .from('user_settings')
              .select(
                'user_id, automation_enabled, poll_interval_seconds, max_daily_drafts',
              )
              .eq('user_id', ownerId)
              .maybeSingle(),
          ),
          ownerId,
        ),
      );
    },
  });

  const gmailAccounts = Object.freeze({
    async get(): Promise<GmailAccount | null> {
      return owned(
        await checked<GmailAccount>(
          client
            .from('gmail_accounts')
            .select(accountColumns)
            .eq('user_id', ownerId)
            .maybeSingle(),
        ),
        ownerId,
      );
    },
    async findById(accountId: string): Promise<GmailAccount | null> {
      requireUuid(accountId);
      return owned(
        await checked<GmailAccount>(
          client
            .from('gmail_accounts')
            .select(accountColumns)
            .eq('user_id', ownerId)
            .eq('id', accountId)
            .maybeSingle(),
        ),
        ownerId,
      );
    },
  });

  const processingRuns = Object.freeze({
    async list(limit = 20): Promise<ProcessingRun[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new DataAccessError('INVALID_INPUT');
      const rows = requireResource(
        await checked<ProcessingRun[]>(
          client
            .from('processing_runs')
            .select(runColumns)
            .eq('user_id', ownerId)
            .order('started_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(limit),
        ),
      );
      for (const row of rows) owned(row, ownerId);
      return rows;
    },
    async findById(
      runId: string,
      accountId?: string,
    ): Promise<ProcessingRun | null> {
      requireUuid(runId);
      let query = client
        .from('processing_runs')
        .select(runColumns)
        .eq('user_id', ownerId)
        .eq('id', runId);
      if (accountId !== undefined) {
        requireUuid(accountId);
        query = query.eq('gmail_account_id', accountId);
      }
      const row = owned(
        await checked<ProcessingRun>(query.maybeSingle()),
        ownerId,
      );
      if (row && accountId !== undefined && row.gmail_account_id !== accountId)
        throw new DataAccessError('UNAVAILABLE');
      return row;
    },
    async start(
      accountId: string,
      trigger: RunTrigger,
    ): Promise<ProcessingRun> {
      if (!['MANUAL', 'SCHEDULED', 'RETRY'].includes(trigger))
        throw new DataAccessError('INVALID_INPUT');
      requireResource(await gmailAccounts.findById(accountId));
      return requireResource(
        owned(
          await checked<ProcessingRun>(
            client
              .from('processing_runs')
              .insert({
                user_id: ownerId,
                gmail_account_id: accountId,
                trigger_kind: trigger,
              })
              .select(runColumns)
              .single(),
          ),
          ownerId,
        ),
      );
    },
    async finish(
      runId: string,
      accountId: string,
      outcome: RunOutcome,
    ): Promise<ProcessingRun> {
      requireUuid(runId);
      requireUuid(accountId);
      validateOutcome(outcome);
      const current = requireResource(
        await processingRuns.findById(runId, accountId),
      );
      const started = Date.parse(current.started_at);
      if (!Number.isFinite(started)) throw new DataAccessError('UNAVAILABLE');
      const row = owned(
        await checked<ProcessingRun>(
          client
            .from('processing_runs')
            .update({
              status: outcome.status,
              finished_at: new Date(
                Math.max(Date.now(), started + 1),
              ).toISOString(),
              messages_detected: outcome.messagesDetected,
              messages_processed: outcome.messagesProcessed,
              drafts_created: outcome.draftsCreated,
              error_count: outcome.errorCount,
              error_code: outcome.errorCode ?? null,
            })
            .eq('user_id', ownerId)
            .eq('gmail_account_id', accountId)
            .eq('id', runId)
            .eq('status', 'RUNNING')
            .select(runColumns)
            .maybeSingle(),
        ),
        ownerId,
      );
      if (row && row.gmail_account_id !== accountId)
        throw new DataAccessError('UNAVAILABLE');
      return requireResource(row);
    },
  });

  return Object.freeze({ users, settings, gmailAccounts, processingRuns });
}
