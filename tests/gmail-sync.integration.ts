import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createGmailSyncStore } from '@/db/gmail-sync';
import { readSyncConfig } from '@/worker/sync-config';
import { runSyncCycle, type SyncClaim } from '@/worker/sync';
import type { GmailClient } from '@/providers/contracts';
import { gmailScopes } from '@/config/google';

const service = createClient<Database>(
  process.env.AUTO_EMAIL_TEST_URL!,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: { userId: string; gmailAccountId: string }[] = [];
const config = readSyncConfig({});
const store = createGmailSyncStore(service);
const ref = { id: 'sync_message_1', threadId: 'sync_thread_1' };
const past = () => '2000-01-01T00:00:00.000Z';

async function account(index = 0) {
  const result = await service
    .from('gmail_accounts')
    .select(
      'last_sync_at, sync_window_start_at, sync_lease_id, next_sync_at, updated_at',
    )
    .eq('user_id', owners[index].userId)
    .eq('id', owners[index].gmailAccountId)
    .single();
  expect(result.error).toBeNull();
  return result.data!;
}
async function enable(index = 0) {
  expect(
    (
      await service
        .from('user_settings')
        .update({ automation_enabled: true, poll_interval_seconds: 120 })
        .eq('user_id', owners[index].userId)
    ).error,
  ).toBeNull();
}
async function due(index = 0) {
  expect(
    (
      await service
        .from('gmail_accounts')
        .update({ next_sync_at: past() })
        .eq('id', owners[index].gmailAccountId)
        .eq('user_id', owners[index].userId)
    ).error,
  ).toBeNull();
}
async function claim(): Promise<SyncClaim> {
  const result = await store.claim(config);
  expect(result).not.toBeNull();
  return result!;
}

describe('MAIL-029 worker con PostgreSQL real, sin navegador y Gmail simulado', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `mail029-${crypto.randomUUID()}@example.invalid`;
      const user = await service.auth.admin.createUser({
        email,
        password: 'Mail029-Synthetic-Password!',
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      const userId = user.data.user!.id;
      owners.push({ userId, gmailAccountId: '' });
      const result = await service
        .from('gmail_accounts')
        .insert({
          user_id: userId,
          email,
          status: 'CONNECTED',
          scope_set: [...gmailScopes],
          encrypted_refresh_token: `\\x${'01'.repeat(40)}`,
        })
        .select('id')
        .single();
      expect(result.error).toBeNull();
      owners[i].gmailAccountId = result.data!.id;
    }
  });
  beforeEach(async () => {
    for (const owner of owners) {
      expect(
        (
          await service
            .from('gmail_sync_messages')
            .delete()
            .eq('user_id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (
          await service
            .from('processing_runs')
            .delete()
            .eq('user_id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (
          await service
            .from('user_settings')
            .update({ automation_enabled: false })
            .eq('user_id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (
          await service
            .from('gmail_accounts')
            .update({
              status: 'CONNECTED',
              last_sync_at: null,
              sync_lease_id: null,
              sync_lease_expires_at: null,
              sync_window_start_at: null,
              next_sync_at: past(),
            })
            .eq('user_id', owner.userId)
            .eq('id', owner.gmailAccountId)
        ).error,
      ).toBeNull();
    }
  });
  afterAll(async () => {
    for (const owner of owners)
      expect(
        (await service.auth.admin.deleteUser(owner.userId)).error,
      ).toBeNull();
  });

  it('solo reclama cuentas habilitadas y serializa dos workers sobre la misma cuenta', async () => {
    expect(await store.claim(config)).toBeNull();
    await enable();
    const claims = await Promise.all([
      store.claim(config),
      store.claim(config),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject(owners[0]);
    expect((await account()).last_sync_at).toBeNull();
  });

  it('persiste cada página, reconcilia un fallo y evita duplicados después de reiniciar', async () => {
    await enable();
    const listMessages = vi
      .fn<GmailClient['listMessages']>()
      .mockResolvedValueOnce({ messages: [ref], nextPageToken: 'next' })
      .mockRejectedValueOnce(new Error('synthetic-private-body'));
    const report = vi.fn();
    expect(
      await runSyncCycle(
        { store, gmailFor: async () => ({ listMessages }), report },
        config,
      ),
    ).toEqual({ completed: 0, failed: 1 });
    const failed = await account();
    expect(failed.last_sync_at).toBeNull();
    expect(failed.sync_window_start_at).not.toBeNull();
    expect(failed.sync_lease_id).toBeNull();
    // The interval starts when finishing, not when the Gmail read starts.
    const retryDelay =
      Date.parse(failed.next_sync_at) - Date.parse(failed.updated_at);
    expect(retryDelay).toBeGreaterThanOrEqual(119000);
    expect(retryDelay).toBeLessThanOrEqual(121000);
    expect(await store.claim(config)).toBeNull();
    await due();

    const restartedStore = createGmailSyncStore(service);
    const secondRef = { id: 'sync_message_2', threadId: 'sync_thread_2' };
    listMessages.mockResolvedValueOnce({ messages: [ref, secondRef] });
    expect(
      await runSyncCycle(
        {
          store: restartedStore,
          gmailFor: async () => ({ listMessages }),
          report,
        },
        config,
      ),
    ).toEqual({ completed: 1, failed: 0 });
    expect(listMessages.mock.calls[2][0]!.after!.toISOString()).toBe(
      new Date(failed.sync_window_start_at!).toISOString(),
    );
    const successful = await account();
    expect(successful.last_sync_at).not.toBeNull();
    expect(successful.sync_window_start_at).toBeNull();
    const rows = await service
      .from('gmail_sync_messages')
      .select('message_id, thread_id, user_id')
      .eq('gmail_account_id', owners[0].gmailAccountId);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(2);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'SYNC_COMPLETED', messagesDetected: 1 }),
    );

    await due();
    const next = await claim();
    expect(Date.parse(next.windowStartAt)).toBe(
      Date.parse(successful.last_sync_at!) - config.overlapSeconds * 1000,
    );
    expect(await restartedStore.recordPage(next, [ref, secondRef])).toBe(0);
    expect(await restartedStore.finish(next)).toBe(true);
  });

  it('recupera un proceso caído, cierra su ejecución y rechaza el lease antiguo', async () => {
    await enable();
    const old = await claim();
    await store.recordPage(old, [ref]);
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ sync_lease_expires_at: past() })
          .eq('id', old.gmailAccountId)
          .eq('user_id', old.userId)
      ).error,
    ).toBeNull();
    const recovered = await claim();
    expect(recovered.runId).not.toBe(old.runId);
    expect(recovered.windowStartAt).toBe(old.windowStartAt);
    expect(await store.renew(old, config.leaseSeconds)).toBe(false);
    expect(await store.finish(old)).toBe(false);
    await expect(store.recordPage(old, [ref])).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(await store.recordPage(recovered, [ref])).toBe(0);
    const previous = await service
      .from('processing_runs')
      .select('status, error_code, messages_detected')
      .eq('id', old.runId)
      .single();
    expect(previous.data).toEqual({
      status: 'FAILED',
      error_code: 'SYNC_INTERRUPTED',
      messages_detected: 1,
    });
    expect(await store.finish(recovered)).toBe(true);
  });

  it('valida el propietario, respeta pausa y conserva el cursor ante una desactivación', async () => {
    await enable();
    const active = await claim();
    const foreign = { ...active, userId: owners[1].userId };
    expect(await store.renew(foreign, config.leaseSeconds)).toBe(false);
    expect(await store.finish(foreign)).toBe(false);
    await expect(store.recordPage(foreign, [ref])).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(
      (
        await service
          .from('user_settings')
          .update({ automation_enabled: false })
          .eq('user_id', active.userId)
      ).error,
    ).toBeNull();
    expect(await store.renew(active, config.leaseSeconds)).toBe(false);
    await expect(store.finish(active)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(await store.finish(active, 'SYNC_STOPPED')).toBe(true);
    expect((await account()).last_sync_at).toBeNull();
  });

  it('permite sincronizar cuentas diferentes y no deduplica entre buzones', async () => {
    await enable(0);
    await enable(1);
    const claims = await Promise.all([
      store.claim(config),
      store.claim(config),
    ]);
    expect(claims.every(Boolean)).toBe(true);
    expect(new Set(claims.map((c) => c!.gmailAccountId)).size).toBe(2);
    for (const current of claims) {
      expect(await store.recordPage(current!, [ref, ref])).toBe(1);
      expect(await store.finish(current!)).toBe(true);
    }
  });
});
