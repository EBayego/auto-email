import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createProviderRequestGate } from '@/db/provider-request-gate';
import { createEmailJobStore } from '@/db/email-jobs';
import { createProviderRequestExecutor } from '@/providers/request-policy';
import { ProviderError } from '@/providers/errors';
import { readRequestPolicyConfig } from '@/worker/request-config';
import { runEmailJobCycle } from '@/worker/email-jobs';
import type { EmailClassification } from '@/modules/classifier/contracts';
import { gmailScopes } from '@/config/google';

const service = createClient<Database>(
  process.env.AUTO_EMAIL_TEST_URL!,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const limits = {
  maxConcurrent: 10,
  accountMaxConcurrent: 1,
  requestsPerMinute: 100,
  accountRequestsPerMinute: 50,
};
const owners: { userId: string; gmailAccountId: string; email: string }[] = [];
const gate = (index: number) =>
  createProviderRequestGate(service, owners[index]);

describe('MAIL-033 cuotas compartidas con PostgreSQL real', () => {
  beforeEach(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `mail033-${crypto.randomUUID()}@example.invalid`;
      const result = await service.auth.admin.createUser({
        email,
        password: 'Mail033-Synthetic-Password!',
        email_confirm: true,
      });
      expect(result.error).toBeNull();
      const work = { userId: result.data.user!.id, gmailAccountId: '', email };
      owners.push(work);
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: work.userId,
          email,
          status: 'CONNECTED',
          scope_set: [...gmailScopes],
          encrypted_refresh_token: `\\x${'01'.repeat(40)}`,
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      work.gmailAccountId = account.data!.id;
    }
  });
  afterEach(async () => {
    for (const owner of owners)
      expect(
        (await service.auth.admin.deleteUser(owner.userId)).error,
      ).toBeNull();
    owners.length = 0;
  });
  it('un solo permiso gana entre doce peticiones concurrentes de varios clientes', async () => {
    const permits = await Promise.all(
      Array.from({ length: 12 }, () =>
        gate(0).acquire('google', { ...limits, maxConcurrent: 1 }, 30),
      ),
    );
    const acquired = permits.filter((permit) => permit.leaseId);
    expect(acquired).toHaveLength(1);
    expect(
      permits
        .filter((permit) => !permit.leaseId)
        .every((permit) => permit.retryAfterMs > 0),
    ).toBe(true);
    await gate(0).release(acquired[0].leaseId!);
    expect(
      (await gate(0).acquire('google', { ...limits, maxConcurrent: 1 }, 30))
        .leaseId,
    ).not.toBeNull();
  });
  it('aplica el límite global entre cuentas distintas', async () => {
    const permits = await Promise.all([
      gate(0).acquire('google', { ...limits, maxConcurrent: 1 }, 30),
      gate(1).acquire('google', { ...limits, maxConcurrent: 1 }, 30),
    ]);
    expect(permits.filter((permit) => permit.leaseId)).toHaveLength(1);
  });
  it('separa cuotas por proveedor y limita las peticiones simultáneas de cada cuenta', async () => {
    const first = await gate(0).acquire('google', limits, 30);
    const second = await gate(1).acquire('google', limits, 30);
    expect(first.leaseId).not.toBeNull();
    expect(second.leaseId).not.toBeNull();
    expect((await gate(0).acquire('google', limits, 30)).leaseId).toBeNull();
    expect(
      (await gate(0).acquire('openai', limits, 30)).leaseId,
    ).not.toBeNull();
  });
  it('liberar concurrencia no devuelve las llamadas consumidas de una cuenta', async () => {
    const policy = { ...limits, accountRequestsPerMinute: 1 };
    const first = await gate(0).acquire('google', policy, 30);
    await gate(0).release(first.leaseId!);
    const second = await gate(0).acquire('google', policy, 30);
    expect(second.leaseId).toBeNull();
    expect(second.retryAfterMs).toBeGreaterThan(55000);
    expect(
      (await gate(1).acquire('google', policy, 30)).leaseId,
    ).not.toBeNull();
  });
  it('limita también las llamadas por minuto del proveedor completo', async () => {
    const policy = { ...limits, requestsPerMinute: 1 };
    const first = await gate(0).acquire('google', policy, 30);
    await gate(0).release(first.leaseId!);
    expect((await gate(1).acquire('google', policy, 30)).leaseId).toBeNull();
  });
  it('un trabajador nuevo respeta Retry-After persistido para Gmail sin bloquear otro buzón', async () => {
    await gate(0).cooldown('google', 30000);
    const permit = await createProviderRequestGate(service, owners[0]).acquire(
      'google',
      limits,
      30,
    );
    expect(permit.leaseId).toBeNull();
    expect(permit.retryAfterMs).toBeGreaterThan(29000);
    expect(
      (await gate(1).acquire('google', limits, 30)).leaseId,
    ).not.toBeNull();
  });
  it('rechaza propiedad cruzada y llamadas desde el navegador', async () => {
    await expect(
      createProviderRequestGate(service, {
        userId: owners[1].userId,
        gmailAccountId: owners[0].gmailAccountId,
      }).acquire('google', limits, 30),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const browser = createClient<Database>(
      process.env.AUTO_EMAIL_TEST_URL!,
      process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    try {
      expect(
        (
          await browser.auth.signInWithPassword({
            email: owners[0].email,
            password: 'Mail033-Synthetic-Password!',
          })
        ).error,
      ).toBeNull();
      const result = await browser.rpc('acquire_provider_request', {
        p_provider: 'google',
        p_lease_seconds: 30,
        p_max_concurrent: 1,
        p_account_max_concurrent: 1,
        p_requests_per_minute: 100,
        p_account_requests_per_minute: 50,
        p_user_id: owners[0].userId,
        p_account_id: owners[0].gmailAccountId,
      });
      expect(result.error?.code).toBe('42501');
    } finally {
      await browser.auth.signOut({ scope: 'local' });
    }
  });
  it('agota el fallo transitorio, guarda el motivo final y continúa con otro trabajo', async () => {
    const owner = owners[0];
    expect(
      (
        await service
          .from('user_settings')
          .update({ automation_enabled: true })
          .eq('user_id', owner.userId)
      ).error,
    ).toBeNull();
    expect(
      (
        await service.from('gmail_sync_messages').insert(
          ['retry33', 'ok33'].map((id) => ({
            user_id: owner.userId,
            gmail_account_id: owner.gmailAccountId,
            message_id: id,
            thread_id: `thread_${id}`,
          })),
        )
      ).error,
    ).toBeNull();
    let elapsed = 0;
    const execute = createProviderRequestExecutor({
      gate: gate(0),
      config: readRequestPolicyConfig({}),
      now: () => elapsed,
      pause: async (ms) => {
        elapsed += ms;
      },
      random: () => 1,
    });
    const operation = vi.fn(async () => {
      throw new ProviderError('openai', 'UNAVAILABLE');
    });
    const noReply: EmailClassification = {
      decision: 'NO_REPLY',
      intent: 'NOTIFICATION',
      reasons: ['INFORMATION_ONLY'],
      explanation: '',
      source: 'RULE',
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      riskFlags: [],
      needsAttachment: false,
    };
    const store = createEmailJobStore(service);
    const deps = {
      store,
      inspect: async () => ({ status: 'CONTINUE' as const }),
      classifierFor: async () => ({
        classify: async (id: string) => {
          if (id === 'retry33') await execute('openai', true, operation);
          return noReply;
        },
      }),
      report: vi.fn(),
    };
    const config = { leaseSeconds: 300, maxJobsPerCycle: 10 };
    expect(await runEmailJobCycle(deps, config)).toMatchObject({
      failed: 1,
      skipped: 1,
      claimed: 2,
    });
    expect(operation).toHaveBeenCalledTimes(3);
    const rows = await service
      .from('email_jobs')
      .select('status,reason_code')
      .eq('user_id', owner.userId)
      .eq('target_message_id', 'retry33')
      .single();
    expect(rows.data).toEqual({
      status: 'FAILED',
      reason_code: 'JOB_OPENAI_UNAVAILABLE_ATTEMPTS',
    });
    expect(await runEmailJobCycle(deps, config)).toMatchObject({ claimed: 0 });
    expect(operation).toHaveBeenCalledTimes(3);
  });
  it('comparte la suspensión del proyecto de OpenAI entre cuentas', async () => {
    await gate(0).cooldown('openai', 1000);
    const permit = await gate(1).acquire('openai', limits, 30);
    expect(permit.leaseId).toBeNull();
    expect(permit.retryAfterMs).toBeGreaterThan(0);
  });
});
