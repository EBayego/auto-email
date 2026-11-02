import { createAuthorizedTestUser } from './fixtures/privacy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { gmailScopes } from '@/config/google';
import { createAnalyticsRepository } from '@/db/analytics-dashboard';
import {
  analyticsRates,
  analyticsSnapshotSchema,
} from '@/modules/analytics/dashboard';
import { generationConfiguration } from '@/modules/analytics/generations';
import { compareReplies } from '@/modules/analytics/reply-comparison';
import { writingProfileFixture } from './fixtures/writing-profile';
import { seedActivityJob } from './fixtures/activity-store';
import { generationRetentionSnapshotSchema } from '@/modules/analytics/retention';
const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: {
  id: string;
  accountId: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
}[] = [];
const asOf = '2026-10-31T12:00:00Z',
  start = '2026-10-24T22:00:00Z',
  beforeStart = '2026-10-24T21:59:59.999Z';
const sentAt = '2026-10-31T12:30:00Z'; // A later send belongs to its original creation cohort.
const edited = compareReplies(
  'Confirmo recepción.',
  'Confirmo recepción de 125 euros.',
);
let sequence = 0;
async function seed(
  options: {
    owner?: number;
    at?: string;
    outcome?:
      'SENT' | 'MANUAL_REPLY' | 'INDETERMINATE' | 'PENDING' | 'DISCARDED';
    draft?: boolean;
    status?: 'CREATED' | 'UNCERTAIN' | 'CANCELLED';
    cost?: number;
    feedback?: 'UNCHANGED' | 'EDITED' | 'SKIPPED';
    failed?: boolean;
    runOnly?: boolean;
  } = {},
) {
  const owner = owners[options.owner ?? 0],
    n = ++sequence,
    id = crypto.randomUUID(),
    runId = crypto.randomUUID(),
    revision = crypto.randomUUID(),
    at = options.at ?? '2026-10-25T00:30:00Z',
    thread = `PRIVATE_thread60_${n}`,
    target = `PRIVATE_incoming60_${n}`;
  const configuration = generationConfiguration(
    {
      id: runId,
      context: {
        accountId: owner.accountId,
        threadId: thread,
        targetMessageId: target,
        historyId: null,
        styleRevision: revision,
        replyTarget: {
          to: { name: '', address: 'contact@example.invalid' },
          subject: 'PRIVATE_SUBJECT',
          inReplyTo: '<incoming@example.invalid>',
          references: [],
        },
        modelInput: {
          schemaVersion: 1,
          subject: null,
          messages: [],
          style: writingProfileFixture(),
        },
      },
      response: null,
      durationMs: 100,
    },
    { reasoningEffort: 'none' },
  );
  expect(
    (
      await service.from('generation_runs').insert({
        id: runId,
        user_id: owner.id,
        gmail_account_id: owner.accountId,
        thread_id: thread,
        target_message_id: target,
        generation_version: 1,
        status: options.failed ? 'FAILED' : 'READY',
        model: 'PRIVATE_MODEL60',
        configuration: configuration as Exclude<Json, null>,
        input_tokens: options.failed ? null : 100,
        output_tokens: options.failed ? null : 30,
        model_calls: options.failed ? null : 2,
        duration_ms: 100,
        created_at: at,
        estimated_cost_usd: options.cost ?? null,
        pricing:
          options.cost === undefined
            ? null
            : {
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 1,
                currency: 'USD',
                method: 'uncached_upper_estimate',
              },
      })
    ).error,
  ).toBeNull();
  if (options.runOnly) return { runId, id };
  const outcome = options.outcome ?? 'SENT',
    messageId = `sent60_${n}`;
  const sentOutcome =
    outcome === 'SENT'
      ? { status: outcome, reason: 'MATCHED_MARKER', messageId, sentAt }
      : outcome === 'MANUAL_REPLY'
        ? { status: outcome, reason: 'SEPARATE_REPLY', messageId, sentAt }
        : outcome === 'DISCARDED'
          ? { status: outcome, reason: 'WRITE_CANCELLED' }
          : outcome === 'INDETERMINATE'
            ? { status: outcome, reason: 'MISSING_DRAFT' }
            : { status: outcome, reason: 'DRAFT_PRESENT' };
  expect(
    (
      await service.from('draft_generations').insert({
        id,
        user_id: owner.id,
        gmail_account_id: owner.accountId,
        thread_id: thread,
        target_message_id: target,
        generation_run_id: runId,
        style_revision: revision,
        model: 'PRIVATE_MODEL60',
        prompt_version: 'mail049-v1',
        input_tokens: 100,
        output_tokens: 30,
        status: options.status ?? 'CREATED',
        reason_code:
          options.status === 'UNCERTAIN'
            ? 'GMAIL_WRITE_UNCERTAIN'
            : options.status === 'CANCELLED'
              ? 'PREWRITE_FAILED'
              : null,
        draft_id: options.draft === false ? null : `draft60_${n}`,
        draft_message_id:
          options.draft === false ? null : `draftMessage60_${n}`,
        created_at: at,
        write_started_at: options.status === 'CANCELLED' ? null : at,
        sent_outcome: sentOutcome,
      })
    ).error,
  ).toBeNull();
  if (options.feedback) {
    const metrics =
      options.feedback === 'UNCHANGED'
        ? compareReplies('Confirmo recepción.', 'Confirmo recepción.')
        : edited;
    expect(
      (
        await service.from('feedback_events').insert({
          user_id: owner.id,
          gmail_account_id: owner.accountId,
          draft_generation_id: id,
          generation_run_id: runId,
          sent_message_id: messageId,
          sent_at: sentAt,
          status: options.feedback === 'SKIPPED' ? 'SKIPPED' : 'COMPLETED',
          processed_at: sentAt,
          reason_code:
            options.feedback === 'SKIPPED' ? 'ORIGINAL_UNAVAILABLE' : null,
          metrics: options.feedback === 'SKIPPED' ? null : metrics,
        })
      ).error,
    ).toBeNull();
  }
  return { id, runId };
}
async function snapshot(days = 7, index = 0, observedAt = asOf) {
  const result = await service.rpc('get_analytics_dashboard', {
    p_user_id: owners[index].id,
    p_days: days,
    p_as_of: observedAt,
  });
  expect(result.error).toBeNull();
  return analyticsSnapshotSchema.parse(result.data);
}
const request = (path = '/api/analytics?days=7', index = 0) =>
  fetch(`${origin}${path}`, {
    headers: {
      cookie: [...owners[index].jar]
        .map(([key, value]) => `${key}=${value}`)
        .join('; '),
    },
  });
describe('MAIL-060 agregados reales, privacidad y periodos', () => {
  beforeAll(async () => {
    if (new URL(url).origin !== 'http://127.0.0.1:55321')
      throw new Error('Solo Supabase local');
    for (let n = 0; n < 2; n++) {
      const email = `mail060-${crypto.randomUUID()}@example.invalid`,
        password = `Mail60-${crypto.randomUUID()}!`;
      const result = await createAuthorizedTestUser(service, {
        email,
        password,
        email_confirm: true,
      });
      expect(result.error).toBeNull();
      const jar = new Map<string, string>(),
        client = createAuthClient(
          {
            getAll: () => [...jar].map(([name, value]) => ({ name, value })),
            setAll: (values) => {
              for (const { name, value } of values) {
                if (value) jar.set(name, value);
                else jar.delete(name);
              }
            },
          },
          {
            appOrigin: origin,
            supabaseUrl: url,
            publishableKey: process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
            secureCookies: false,
          },
        );
      owners.push({ id: result.data.user!.id, accountId: '', jar, client });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: owners[n].id,
          email,
          status: 'CONNECTED',
          encrypted_refresh_token: '\\x0102',
          scope_set: [...gmailScopes],
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owners[n].accountId = account.data!.id;
    }
    await seed({ at: start, feedback: 'UNCHANGED', cost: 0.001 });
    await seed({ feedback: 'EDITED', cost: 0.003 });
    await seed({ feedback: 'SKIPPED', cost: 0 });
    await seed({ draft: false, status: 'UNCERTAIN' });
    await seed({ outcome: 'PENDING' });
    await seed({ outcome: 'INDETERMINATE' });
    await seed({ outcome: 'MANUAL_REPLY' });
    await seed({ outcome: 'DISCARDED', draft: false, status: 'CANCELLED' });
    await seed({ outcome: 'INDETERMINATE', draft: false, status: 'UNCERTAIN' });
    await seed({ failed: true, runOnly: true });
    await seed({ at: beforeStart, feedback: 'UNCHANGED', cost: 0.002 });
    await seed({ at: '2026-10-18T07:59:59Z', cost: 0.05 });
    await seed({ owner: 1, cost: 99 });
    await seedActivityJob(service, owners[0], {
      createdAt: start,
      status: 'SKIPPED',
      reason: 'EXCLUDED_DOMAIN',
    });
    await seedActivityJob(service, owners[0], {
      createdAt: start,
      status: 'SKIPPED',
      reason: 'EXCLUDED_DOMAIN',
    });
    await seedActivityJob(service, owners[0], {
      createdAt: start,
      status: 'REVIEW_REQUIRED',
      reason: 'INSUFFICIENT_CONTEXT',
    });
    await seedActivityJob(service, owners[0], {
      createdAt: start,
      status: 'FAILED',
    });
  });
  afterAll(async () => {
    for (const owner of owners)
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
  });
  it('cuenta creación probada, envíos y desconocidos sin inferir rechazos', async () => {
    const t = (await snapshot()).current.totals;
    expect(t).toMatchObject({
      generationAttempts: 10,
      generationFailures: 1,
      draftAttempts: 9,
      draftsCreated: 7,
      sendsConfirmed: 4,
      independentReplies: 1,
      discardedBeforeWrite: 1,
      indeterminate: 2,
      pending: 1,
      compared: 2,
      edited: 1,
      unchanged: 1,
      factualReview: 1,
      comparisonSkipped: 1,
      comparisonPending: 1,
      totalEditDistance: edited.editDistance,
    });
    expect(analyticsRates(t)).toMatchObject({
      usage: 4 / 7,
      edited: 0.5,
      comparisonCoverage: 0.5,
    });
  });
  it('calcula cobertura, suma y promedio sin transformar ausencias en ceros', async () => {
    const t = (await snapshot()).current.totals;
    expect(t).toMatchObject({
      usageKnownGenerations: 9,
      usageUnknownGenerations: 1,
      inputTokens: 900,
      outputTokens: 270,
      modelCalls: 18,
      pricedGenerations: 3,
      unpricedGenerations: 7,
      knownCostUsd: 0.004,
      meanDurationMs: 100,
    });
    expect(t.meanKnownCostUsd).toBeCloseTo(0.004 / 3, 10);
  });
  it('mantiene cohortes sin duplicación aun cuando el envío ocurre después', async () => {
    const s = await snapshot();
    expect(s.previous.totals).toMatchObject({
      generationAttempts: 1,
      draftsCreated: 1,
      sendsConfirmed: 1,
      compared: 1,
      knownCostUsd: 0.002,
    });
    expect(s.daily.reduce((sum, day) => sum + day.sendsConfirmed, 0)).toBe(4);
    expect(
      s.daily.reduce((sum, day) => sum + (day.knownCostUsd ?? 0), 0),
    ).toBeCloseTo(0.004, 10);
    expect(s.daily.reduce((sum, day) => sum + day.compared, 0)).toBe(2);
  });
  it('respeta medianoche local, cambio de hora y periodos no solapados de igual duración', async () => {
    const s = await snapshot();
    expect(Date.parse(s.current.from)).toBe(Date.parse(start));
    expect(s.daily).toHaveLength(7);
    expect(s.daily.map((day) => day.day)).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(s.previous.to).toBe(s.current.from);
    expect(Date.parse(s.current.to) - Date.parse(s.current.from)).toBe(
      Date.parse(s.previous.to) - Date.parse(s.previous.from),
    );
    expect(s.daily[0].generationAttempts).toBe(10);
  });
  it.each([30, 90])(
    'genera %i días consecutivos y vacíos explícitos',
    async (days) => {
      const s = await snapshot(days);
      expect(s.daily).toHaveLength(days);
      expect(s.daily.at(-1)?.day).toBe('2026-10-31');
      expect(s.daily[1].knownCostUsd).toBeNull();
    },
  );
  it('cuenta motivos de omisión y revisión sin multiplicarlos por los borradores', async () => {
    const s = await snapshot();
    expect(s.current.totals).toMatchObject({
      jobTotal: 4,
      skippedJobs: 2,
      reviewJobs: 1,
      failedJobs: 1,
    });
    expect(s.omissionReasons).toEqual([{ code: 'EXCLUDED_DOMAIN', count: 2 }]);
    expect(s.reviewReasons).toEqual([
      { code: 'INSUFFICIENT_CONTEXT', count: 1 },
    ]);
    expect(s.omissionOther).toBe(0);
  });
  it('ofrece solo agregados propios desde API y repositorio, sin contenido ni identificadores', async () => {
    // Use the database clock and an already completed instant. A host clock
    // ahead of the Docker VM must not seed a future, not-yet-counted event.
    const observed = await createAnalyticsRepository(service, owners[0].id).get(
      { days: '7' },
    );
    const current = new Date(
      Date.parse(observed.observedAt) - 60000,
    ).toISOString();
    await seed({ owner: 0, at: current, outcome: 'SENT', cost: 1 });
    await seed({ owner: 1, at: current, outcome: 'SENT', cost: 99 });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const s = analyticsSnapshotSchema.parse(await response.json());
    expect(s.current.totals).toEqual(
      (await snapshot(7, 0, s.observedAt)).current.totals,
    );
    expect(s.current.totals.sendsConfirmed).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toMatch(
      /PRIVATE_|thread_id|configuration|body_text/,
    );
    for (const owner of owners)
      expect(JSON.stringify(s)).not.toContain(owner.id);
    const own = await createAnalyticsRepository(service, owners[1].id).get({
      days: '7',
    });
    expect(own.current.totals).toEqual(
      (await snapshot(7, 1, own.observedAt)).current.totals,
    );
    expect(own.current.totals.knownCostUsd).toBeGreaterThanOrEqual(99);
    expect(s.current.totals.knownCostUsd).not.toBe(
      own.current.totals.knownCostUsd,
    );
  });
  it('muestra la página y el enlace de navegación con sesión', async () => {
    const response = await request('/analytics?days=7');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await response.text();
    expect(html).toContain('Uso observado');
    expect(html).toContain('Tendencia diaria');
    expect(html).toContain('href="/analytics"');
  });
  it('EPIC-09 permite autorizar y retirar la comparación desde los ajustes de la cuenta propia', async () => {
    const page = await request('/settings');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Comparar mis correcciones');
    const path = `/api/learning/retention?accountId=${owners[0].accountId}`;
    const initial = generationRetentionSnapshotSchema.parse(
      await (await request(path)).json(),
    );
    expect(initial.enabled).toBe(false);
    const change = (body: unknown) =>
      fetch(`${origin}/api/learning/retention`, {
        method: 'PUT',
        headers: {
          origin,
          'content-type': 'application/json',
          cookie: [...owners[0].jar]
            .map(([name, value]) => `${name}=${value}`)
            .join('; '),
        },
        body: JSON.stringify(body),
      });
    expect(
      (
        await change({
          accountId: owners[0].accountId,
          enabled: true,
          retentionHours: 24,
          noticeVersion: 'mail056-v1',
        })
      ).status,
    ).toBe(204);
    const enabled = generationRetentionSnapshotSchema.parse(
      await (await request(path)).json(),
    );
    expect(enabled).toMatchObject({
      enabled: true,
      retentionHours: 24,
      noticeVersion: 'mail056-v1',
    });
    expect(
      (
        await service
          .from('generation_temporary_content')
          .select('generation_run_id')
          .eq('user_id', owners[0].id)
      ).data,
    ).toHaveLength(0);
    expect(
      (
        await change({
          accountId: owners[1].accountId,
          enabled: true,
          retentionHours: 24,
          noticeVersion: 'mail056-v1',
        })
      ).status,
    ).toBe(403);
    expect(
      (await change({ accountId: owners[0].accountId, enabled: false })).status,
    ).toBe(204);
    expect(
      generationRetentionSnapshotSchema.parse(
        await (await request(path)).json(),
      ).enabled,
    ).toBe(false);
  });
  it('rechaza sesión ausente y filtros manipulados', async () => {
    expect((await fetch(`${origin}/api/analytics`)).status).toBe(401);
    for (const query of [
      'days=8',
      'days=7&days=90',
      'userId=' + owners[1].id,
      'days=7&asOf=2026-10-31',
    ])
      expect((await request('/api/analytics?' + query)).status).toBe(400);
  });
  it('impide ejecutar RPC privilegiada desde sesión de navegador y anónima', async () => {
    expect(
      (
        await owners[0].client.rpc('get_analytics_dashboard', {
          p_user_id: owners[1].id,
          p_days: 7,
        })
      ).error?.code,
    ).toBe('42501');
    const anonymous = createClient<Database>(
      url,
      process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    expect(
      (
        await anonymous.rpc('get_analytics_dashboard', {
          p_user_id: owners[0].id,
          p_days: 7,
        })
      ).error?.code,
    ).toBe('42501');
  });
  it('mantiene metadatos al desconectar Gmail y bloquea usuario pendiente de borrado', async () => {
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'DISCONNECTED' })
          .eq('id', owners[1].accountId)
      ).error,
    ).toBeNull();
    expect((await request('/api/analytics?days=7', 1)).status).toBe(200);
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DELETION_PENDING' })
          .eq('id', owners[1].id)
      ).error,
    ).toBeNull();
    expect((await request('/api/analytics?days=7', 1)).status).toBe(403);
    const result = await service.rpc('get_analytics_dashboard', {
      p_user_id: owners[1].id,
      p_days: 7,
    });
    expect(result.error?.message).toBe('FORBIDDEN');
  });
});
