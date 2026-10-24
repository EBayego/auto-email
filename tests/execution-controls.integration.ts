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
import { createAuthClient } from '@/modules/auth/client';
import { gmailScopes } from '@/config/google';
import {
  createExecutionControlRepository,
  assertExecutionAllowed,
} from '@/db/execution-controls';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { createProviderRequestGate } from '@/db/provider-request-gate';
import { readRequestPolicyConfig } from '@/worker/request-config';
import { createGmailSyncStore } from '@/db/gmail-sync';
import { createEmailJobStore } from '@/db/email-jobs';
import { readSyncConfig } from '@/worker/sync-config';
import { runMailWorkerCycle } from '@/worker/pipeline';
import type { EmailClassification } from '@/modules/classifier/contracts';
import { writingProfileRow } from './fixtures/writing-profile';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const key = process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
type Owner = {
  userId: string;
  gmailAccountId: string;
  email: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
};
const owners: Owner[] = [];
const config = readSyncConfig({ WORKER_MAX_ACCOUNTS_PER_CYCLE: '1' });
const syncStore = createGmailSyncStore(service),
  jobStore = createEmailJobStore(service);
const noReply: EmailClassification = {
  decision: 'NO_REPLY',
  intent: 'NOTIFICATION',
  reasons: ['INFORMATION_ONLY'],
  explanation: 'Aviso.',
  riskFlags: [],
  needsAttachment: false,
  source: 'RULE',
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
};
function cookies(index = 0) {
  return [...owners[index].jar]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}
async function post(
  body: string,
  index = 0,
  extra: Record<string, string> = {},
) {
  return fetch(`${origin}/api/automation`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookies(index),
      ...extra,
    },
    body,
    redirect: 'manual',
  });
}
async function account(index = 0) {
  const row = await service
    .from('gmail_accounts')
    .select('*')
    .eq('id', owners[index].gmailAccountId)
    .single();
  expect(row.error).toBeNull();
  return row.data!;
}
async function settings(index = 0) {
  const row = await service
    .from('user_settings')
    .select('*')
    .eq('user_id', owners[index].userId)
    .single();
  expect(row.error).toBeNull();
  return row.data!;
}
async function cycle(
  listMessages = vi.fn(async () => ({
    messages: [{ id: 'mail35', threadId: 'thread35' }],
  })),
) {
  const report = vi.fn();
  const result = await runMailWorkerCycle(
    { store: syncStore, gmailFor: async () => ({ listMessages }), report },
    config,
    {
      store: jobStore,
      inspect: async () => ({ status: 'CONTINUE' }),
      classifierFor: async () => ({ classify: async () => noReply }),
      report,
    },
    { leaseSeconds: 300, maxJobsPerCycle: 10 },
  );
  return { result, report, listMessages };
}
describe('MAIL-035 controles HTTP y worker con PostgreSQL real', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `mail035-${crypto.randomUUID()}@example.invalid`,
        password = `Mail035-${crypto.randomUUID()}!`;
      const user = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      const result = await service
        .from('gmail_accounts')
        .insert({
          user_id: user.data.user!.id,
          email,
          status: 'CONNECTED',
          scope_set: [...gmailScopes],
          encrypted_refresh_token: `\\x${'01'.repeat(40)}`,
        })
        .select('id')
        .single();
      expect(result.error).toBeNull();
      const jar = new Map<string, string>();
      const client = createAuthClient(
        {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (values) => {
            for (const cookie of values) {
              if (!cookie.value || cookie.options.maxAge === 0)
                jar.delete(cookie.name);
              else jar.set(cookie.name, cookie.value);
            }
          },
        },
        {
          appOrigin: origin,
          supabaseUrl: url,
          publishableKey: key,
          secureCookies: false,
        },
      );
      owners.push({
        userId: user.data.user!.id,
        gmailAccountId: result.data!.id,
        email,
        jar,
        client,
      });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
    }
  });
  beforeEach(async () => {
    for (const owner of owners) {
      expect(
        (
          await service
            .from('users')
            .update({ status: 'ACTIVE' })
            .eq('id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (
          await service
            .from('user_settings')
            .update({
              automation_enabled: false,
              max_daily_drafts: 30,
              poll_interval_seconds: 300,
            })
            .eq('user_id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (
          await service
            .from('gmail_accounts')
            .update({
              status: 'CONNECTED',
              manual_sync_requested_at: null,
              manual_processing_until: null,
              last_sync_at: null,
              next_sync_at: '2000-01-01',
              sync_lease_id: null,
              sync_lease_expires_at: null,
              sync_window_start_at: null,
            })
            .eq('id', owner.gmailAccountId)
        ).error,
      ).toBeNull();
      for (const table of [
        'draft_generations',
        'email_jobs',
        'gmail_sync_messages',
        'processing_runs',
      ] as const)
        expect(
          (await service.from(table).delete().eq('user_id', owner.userId))
            .error,
        ).toBeNull();
    }
  });
  afterAll(async () => {
    for (const owner of owners) {
      await owner.client.auth.signOut({ scope: 'local' });
      expect(
        (await service.auth.admin.deleteUser(owner.userId)).error,
      ).toBeNull();
    }
  });
  it('edita ajustes desde la sesión propia y muestra los controles en /app', async () => {
    expect(
      (
        await post(
          'action=settings&automationEnabled=true&pollIntervalSeconds=120&maxDailyDrafts=0',
        )
      ).status,
    ).toBe(303);
    expect(await settings()).toMatchObject({
      automation_enabled: true,
      poll_interval_seconds: 120,
      max_daily_drafts: 0,
    });
    expect(await settings(1)).toMatchObject({
      automation_enabled: false,
      max_daily_drafts: 30,
    });
    const response = await fetch(`${origin}/app`, {
      headers: { cookie: cookies() },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Revisar correos ahora');
    expect(html).toContain('Pausar cuenta Gmail');
    expect(html).toContain('Guardar ajustes');
    expect(html).not.toContain('encrypted_refresh_token');
  });
  it('procesa una revisión manual con automatización desactivada sin duplicar al reactivar', async () => {
    expect((await post('action=run')).status).toBe(303);
    expect((await account()).manual_sync_requested_at).not.toBeNull();
    const first = await cycle();
    expect(first.result.failed).toBe(false);
    expect(first.listMessages).toHaveBeenCalledOnce();
    expect((await settings()).automation_enabled).toBe(false);
    const run = await service
      .from('processing_runs')
      .select('trigger_kind,status')
      .eq('user_id', owners[0].userId)
      .single();
    expect(run.data).toEqual({ trigger_kind: 'MANUAL', status: 'COMPLETED' });
    expect(
      (
        await service
          .from('email_jobs')
          .select('status')
          .eq('user_id', owners[0].userId)
      ).data,
    ).toEqual([{ status: 'SKIPPED' }]);
    const cursor = (await account()).last_sync_at;
    expect((await post('action=pause')).status).toBe(303);
    expect((await post('action=run')).status).toBe(403);
    expect((await post('action=resume')).status).toBe(303);
    expect((await account()).last_sync_at).toBe(cursor);
    expect((await cycle()).listMessages).not.toHaveBeenCalled();
    expect((await post('action=run')).status).toBe(303);
    expect((await cycle()).result.failed).toBe(false);
    expect(
      (
        await service
          .from('email_jobs')
          .select('status')
          .eq('user_id', owners[0].userId)
      ).data,
    ).toEqual([{ status: 'SKIPPED' }]);
    expect((await account()).manual_sync_requested_at).toBeNull();
  });
  it('pausar durante una lectura impide confirmar la página y no avanza el cursor', async () => {
    expect(
      (
        await post(
          'action=settings&automationEnabled=true&pollIntervalSeconds=300&maxDailyDrafts=30',
        )
      ).status,
    ).toBe(303);
    const list = vi.fn(async () => {
      expect((await post('action=pause')).status).toBe(303);
      return { messages: [{ id: 'late35', threadId: 'thread35' }] };
    });
    expect((await cycle(list)).result.failed).toBe(true);
    expect((await account()).last_sync_at).toBeNull();
    expect(
      (
        await service
          .from('gmail_sync_messages')
          .select('message_id')
          .eq('user_id', owners[0].userId)
      ).data,
    ).toEqual([]);
    await expect(
      assertExecutionAllowed(service, owners[0]),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('desactivar detiene también una solicitud manual y no cambia el estado de conexión', async () => {
    await post('action=run');
    expect(
      (await post('action=settings&pollIntervalSeconds=300&maxDailyDrafts=30'))
        .status,
    ).toBe(303);
    expect(await account()).toMatchObject({
      status: 'CONNECTED',
      manual_sync_requested_at: null,
      manual_processing_until: null,
    });
    expect((await cycle()).listMessages).not.toHaveBeenCalled();
  });
  it.each(['DISCONNECTED', 'REAUTH_REQUIRED'] as const)(
    'una cuenta %s no puede reactivarse ni solicitar procesamiento',
    async (status) => {
      expect(
        (
          await service
            .from('gmail_accounts')
            .update({ status })
            .eq('id', owners[0].gmailAccountId)
        ).error,
      ).toBeNull();
      expect((await post('action=resume')).status).toBe(403);
      expect((await post('action=run')).status).toBe(403);
      expect((await cycle()).listMessages).not.toHaveBeenCalled();
    },
  );
  it('suspender el usuario bloquea la solicitud incluso con una sesión válida', async () => {
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DISABLED' })
          .eq('id', owners[0].userId)
      ).error,
    ).toBeNull();
    expect((await post('action=run')).status).toBe(403);
    expect((await cycle()).listMessages).not.toHaveBeenCalled();
  });
  it('no acepta identidades ajenas, un origen externo ni acceso directo a los RPC de backend', async () => {
    expect((await post(`action=run&userId=${owners[1].userId}`)).status).toBe(
      400,
    );
    expect(
      (await post('action=run', 0, { origin: 'https://attacker.invalid' }))
        .status,
    ).toBe(400);
    expect(
      (
        await owners[0].client.rpc('request_manual_processing', {
          p_user_id: owners[1].userId,
          p_account_id: owners[1].gmailAccountId,
        })
      ).error?.code,
    ).toBe('42501');
    expect((await account(1)).manual_sync_requested_at).toBeNull();
  });
  it('el permiso manual caduca y el control de proveedores rechaza trabajo nuevo', async () => {
    await post('action=run');
    await cycle();
    await assertExecutionAllowed(service, owners[0]);
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ manual_processing_until: '2000-01-01' })
          .eq('id', owners[0].gmailAccountId)
      ).error,
    ).toBeNull();
    const gate = createProviderRequestGate(service, owners[0], true);
    await expect(
      gate.acquire('openai', readRequestPolicyConfig({}).limits.openai, 40),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('varios procesos compiten por una única plaza diaria sin superarla', async () => {
    const owner = owners[0];
    await createExecutionControlRepository(service, owner.userId).settings({
      automationEnabled: true,
      pollIntervalSeconds: 300,
      maxDailyDrafts: 1,
    });
    const repo = createDraftGenerationRepository(
      service,
      owner.userId,
      owner.gmailAccountId,
    );
    const reservations = Array.from({ length: 5 }, (_, i) => ({
      id: crypto.randomUUID(),
      threadId: `quota35_${i}`,
      targetMessageId: `message35_${i}`,
      styleRevision: writingProfileRow().revision,
      model: 'test-model',
      inputTokens: 0,
      outputTokens: 0,
    }));
    for (const reservation of reservations) await repo.reserve(reservation);
    const results = await Promise.allSettled(
      reservations.map((r) =>
        repo.beginWrite(r.id, r.threadId, r.targetMessageId),
      ),
    );
    expect(
      results.filter((r) => r.status === 'fulfilled' && r.value === true),
    ).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ reason: 'DAILY_DRAFT_LIMIT' });
    expect(
      (await service.rpc('daily_draft_usage', { p_user_id: owner.userId }))
        .data,
    ).toBe(1);
  });
});
