import { createAuthorizedTestUser } from './fixtures/privacy';
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
import type { Database, Json } from '@/db/database.types';
import { createReplyComparisonStore } from '@/db/reply-comparisons';
import { createGenerationRetentionRepository } from '@/db/generation-retention';
import { generationConfiguration } from '@/modules/analytics/generations';
import { responsePromptVersion } from '@/modules/response/prompts';
import { compareReplies } from '@/modules/analytics/reply-comparison';
import { runReplyComparisons } from '@/worker/reply-comparisons';
import { runSentDraftTracking } from '@/worker/sent-draft-tracking';
import { createSentDraftTrackingStore } from '@/db/sent-draft-tracking';
import { sentDraftFixture } from './fixtures/sent-drafts';
import { writingProfileFixture } from './fixtures/writing-profile';
import { ProviderError } from '@/providers/errors';
const service = createClient<Database>(
  process.env.AUTO_EMAIL_TEST_URL!,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const store = createReplyComparisonStore(service);
let userId = '',
  otherUserId = '',
  accountId = '',
  email = '',
  sequence = 0;
const password = `Mail58-${crypto.randomUUID()}!`;
const retention = () => createGenerationRetentionRepository(service, userId);
async function enable() {
  await retention().set({
    accountId,
    enabled: true,
    retentionHours: 24,
    noticeVersion: 'mail056-v1',
  });
}
async function feedback() {
  const result = await service
    .from('feedback_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at');
  expect(result.error).toBeNull();
  return result.data!;
}
async function originalCount() {
  const result = await service
    .from('generation_temporary_content')
    .select('generation_run_id')
    .eq('user_id', userId);
  expect(result.error).toBeNull();
  return result.data!.length;
}
async function seed(
  options: {
    original?: string;
    sent?: string;
    confirmed?: boolean;
    copy?: boolean;
  } = {},
) {
  const f = sentDraftFixture(),
    suffix = String(++sequence),
    runId = crypto.randomUUID(),
    styleRevision = crypto.randomUUID();
  const original = options.original ?? f.body,
    sent = options.sent ?? original;
  Object.assign(f.attempt, {
    userId,
    gmailAccountId: accountId,
    threadId: `thread58_${suffix}`,
    targetMessageId: `incoming58_${suffix}`,
    draftId: `draft58_${suffix}`,
  });
  f.state.sent = [
    {
      ...f.sent,
      id: `sent58_${suffix}`,
      threadId: f.attempt.threadId,
      payload: {
        ...f.sent.payload,
        body: {
          data: Buffer.from(sent).toString('base64url'),
          size: Buffer.byteLength(sent),
        },
      },
    },
  ];
  f.gmail.getThread.mockImplementation(async () => ({
    id: f.attempt.threadId,
    messages: [
      {
        ...f.incoming,
        id: f.attempt.targetMessageId,
        threadId: f.attempt.threadId,
      },
      ...f.state.sent,
    ],
  }));
  const configuration = generationConfiguration(
    {
      id: runId,
      context: {
        accountId,
        threadId: f.attempt.threadId,
        targetMessageId: f.attempt.targetMessageId,
        historyId: null,
        styleRevision,
        replyTarget: {
          to: { name: '', address: 'contact@example.invalid' },
          subject: 'Consulta',
          inReplyTo: f.attempt.intent!.inReplyTo,
          references: [],
        },
        modelInput: {
          schemaVersion: 1,
          style: writingProfileFixture(),
          subject: null,
          messages: [],
        },
      },
      response: null,
      durationMs: 1,
    },
    { reasoningEffort: 'none', maxOutputTokens: 2048 },
  );
  expect(
    (
      await service.from('generation_runs').insert({
        id: runId,
        user_id: userId,
        gmail_account_id: accountId,
        thread_id: f.attempt.threadId,
        target_message_id: f.attempt.targetMessageId,
        generation_version: 1,
        status: 'READY',
        model: 'test-model',
        configuration: configuration as Exclude<Json, null>,
        input_tokens: 100,
        output_tokens: 30,
        model_calls: 2,
        duration_ms: 1,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await service.from('draft_generations').insert({
        id: f.attempt.id,
        user_id: userId,
        gmail_account_id: accountId,
        thread_id: f.attempt.threadId,
        target_message_id: f.attempt.targetMessageId,
        status: 'CREATED',
        draft_id: f.attempt.draftId,
        draft_message_id: `draftMessage58_${suffix}`,
        generation_run_id: runId,
        style_revision: styleRevision,
        model: 'test-model',
        prompt_version: responsePromptVersion,
        input_tokens: 100,
        output_tokens: 30,
        delivery_intent: f.attempt.intent,
        delivery_envelope_hash: f.attempt.envelopeHash,
        draft_internet_message_id: f.attempt.draftInternetMessageId,
        write_started_at: f.attempt.writeStartedAt,
        created_at: new Date(f.writeAt - 60000).toISOString(),
        sent_next_check_at: '2000-01-01T00:00:00Z',
      })
    ).error,
  ).toBeNull();
  if (options.copy !== false) {
    const authorization = await service
      .from('generation_content_authorizations')
      .select('gmail_account_id')
      .eq('gmail_account_id', accountId)
      .maybeSingle();
    if (authorization.data)
      expect(
        (
          await service.from('generation_temporary_content').insert({
            generation_run_id: runId,
            user_id: userId,
            gmail_account_id: accountId,
            body_text: original,
            created_at: new Date(f.writeAt - 60000).toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          })
        ).error,
      ).toBeNull();
  }
  if (options.confirmed !== false)
    await runSentDraftTracking(
      {
        store: createSentDraftTrackingStore(service),
        gmailFor: async () => f.gmail,
        report: vi.fn(),
      },
      100,
    );
  const report = vi.fn();
  return {
    ...f,
    runId,
    original,
    sent,
    report,
    run: async () =>
      runReplyComparisons(
        { store, gmailFor: async () => f.gmail, report },
        100,
      ),
  };
}
async function taskFor(id: string) {
  const tasks = await store.claim(100),
    task = tasks.find((t) => t.draftGenerationId === id);
  expect(task).toBeDefined();
  return task!;
}
describe('MAIL-058 comparación consentida con Supabase real', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const address = `mail58-${crypto.randomUUID()}@example.invalid`,
        created = await createAuthorizedTestUser(service, {
          email: address,
          password,
          email_confirm: true,
        });
      expect(created.error).toBeNull();
      if (i) otherUserId = created.data.user!.id;
      else {
        userId = created.data.user!.id;
        email = address;
      }
    }
    const account = await service
      .from('gmail_accounts')
      .insert({
        user_id: userId,
        email: 'owner@example.invalid',
        status: 'CONNECTED',
        encrypted_refresh_token: '\\x0102',
        scope_set: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.compose',
        ],
      })
      .select('id')
      .single();
    expect(account.error).toBeNull();
    accountId = account.data!.id;
  });
  beforeEach(async () => {
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'CONNECTED' })
          .eq('id', accountId)
      ).error,
    ).toBeNull();
    await retention().set({ accountId, enabled: false });
    expect(
      (await service.from('draft_generations').delete().eq('user_id', userId))
        .error,
    ).toBeNull();
    expect(
      (await service.from('generation_runs').delete().eq('user_id', userId))
        .error,
    ).toBeNull();
  });
  afterAll(async () => {
    for (const id of [userId, otherUserId])
      if (id)
        expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
  });
  it('asocia la comparación al envío confirmado, guarda solo métricas y purga el original tras usarlo', async () => {
    await enable();
    const f = await seed();
    await f.run();
    const [saved] = await feedback();
    expect(saved).toMatchObject({
      status: 'COMPLETED',
      generation_run_id: f.runId,
      draft_generation_id: f.attempt.id,
      reason_code: null,
      metrics: expect.objectContaining({
        classification: 'UNCHANGED',
        similarity: 1,
        editDistance: 0,
      }),
    });
    expect(JSON.stringify(saved)).not.toContain(f.original);
    expect(JSON.stringify(f.report.mock.calls)).not.toContain(f.original);
    expect(await originalCount()).toBe(0);
    await f.run();
    expect(await feedback()).toHaveLength(1);
    expect((await store.claim(100)).some((t) => t.id === saved.id)).toBe(false);
    const daily = await service
      .from('reply_comparison_daily')
      .select('*')
      .eq('user_id', userId);
    expect(daily.error).toBeNull();
    expect(daily.data![0]).toMatchObject({
      total: 1,
      compared: 1,
      unchanged: 1,
      average_similarity: 1,
    });
  });
  it('distingue estilo y cambios factuales sin aprender los segundos, y agrega ambos resultados', async () => {
    await enable();
    const original = 'Hola,\n\nEl precio es 125 euros.\n\nUn saludo.';
    const style = await seed({
      original,
      sent: 'Buenos días,\n\nEl precio es 125 euros.\n\nGracias.',
    });
    await style.run();
    const facts = await seed({
      original,
      sent: 'Buenos días,\n\nEl precio es 90 euros.\n\nGracias.',
    });
    await facts.run();
    const rows = await feedback();
    expect(rows[0].metrics).toMatchObject({
      classification: 'STYLE_ONLY',
      learningEligible: true,
    });
    expect(rows[1].metrics).toMatchObject({
      classification: 'FACTUAL_REVIEW',
      learningEligible: false,
      factualSignals: expect.arrayContaining(['QUANTITIES']),
    });
    const daily = await service
      .from('reply_comparison_daily')
      .select('*')
      .eq('user_id', userId);
    expect(daily.data![0]).toMatchObject({
      compared: 2,
      style_only: 1,
      factual_review: 1,
      learning_eligible: 1,
    });
    const parsed = rows[1].metrics as unknown as ReturnType<
      typeof compareReplies
    >;
    expect(parsed.editDistance).toBe(
      compareReplies(original, facts.sent).editDistance,
    );
  });
  it('no consulta Gmail sin autorización ni muestra como cero una comparación omitida', async () => {
    const f = await seed();
    await f.run();
    expect((await feedback())[0]).toMatchObject({
      status: 'SKIPPED',
      reason_code: 'ORIGINAL_UNAVAILABLE',
      metrics: null,
    });
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
    const daily = await service
      .from('reply_comparison_daily')
      .select('*')
      .eq('user_id', userId);
    expect(daily.data![0]).toMatchObject({
      compared: 0,
      skipped: 1,
      average_similarity: null,
    });
  });
  it('una asociación indeterminada no genera feedback ni lee cuerpos', async () => {
    await enable();
    const f = await seed({ confirmed: false });
    await f.run();
    expect(await feedback()).toEqual([]);
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
  });
  it('la caducidad impide comparar incluso antes de ejecutarse la purga programada', async () => {
    await enable();
    const f = await seed();
    expect(
      (
        await service
          .from('generation_temporary_content')
          .update({
            created_at: new Date(Date.now() - 7200000).toISOString(),
            expires_at: new Date(Date.now() - 3600000).toISOString(),
          })
          .eq('generation_run_id', f.runId)
      ).error,
    ).toBeNull();
    await f.run();
    expect((await feedback())[0]).toMatchObject({
      status: 'SKIPPED',
      reason_code: 'ORIGINAL_UNAVAILABLE',
      metrics: null,
    });
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
  });
  it('revalida la autorización al guardar para no conservar métricas calculadas tras retirarla', async () => {
    await enable();
    const f = await seed(),
      task = await taskFor(f.attempt.id);
    expect(await store.loadOriginal(task)).toBe(f.original);
    await retention().set({ accountId, enabled: false });
    expect(
      await store.finish(task, {
        status: 'COMPLETED',
        metrics: compareReplies(f.original, f.sent),
      }),
    ).toBe(true);
    expect((await feedback())[0]).toMatchObject({
      status: 'SKIPPED',
      reason_code: 'ORIGINAL_UNAVAILABLE',
      metrics: null,
    });
  });
  it('dos workers no comparten lease y un proceso antiguo no puede escribir tras recuperarlo', async () => {
    await enable();
    const f = await seed(),
      sets = await Promise.all([store.claim(100), store.claim(100)]),
      claimed = sets.flat().filter((t) => t.draftGenerationId === f.attempt.id);
    expect(claimed).toHaveLength(1);
    const old = claimed[0];
    expect(
      (
        await service
          .from('feedback_events')
          .update({ lease_expires_at: '2000-01-01T00:00:00Z' })
          .eq('id', old.id)
      ).error,
    ).toBeNull();
    const fresh = await taskFor(f.attempt.id);
    expect(fresh.leaseId).not.toBe(old.leaseId);
    expect(await store.loadOriginal(old)).toBeNull();
    expect(
      await store.finish(old, {
        status: 'COMPLETED',
        metrics: compareReplies(f.original, f.sent),
      }),
    ).toBe(false);
    expect(
      await store.finish(fresh, {
        status: 'COMPLETED',
        metrics: compareReplies(f.original, f.sent),
      }),
    ).toBe(true);
  });
  it('la caducidad ocurrida durante la lectura de Gmail impide persistir las métricas', async () => {
    await enable();
    const f = await seed(),
      task = await taskFor(f.attempt.id);
    expect(await store.loadOriginal(task)).toBe(f.original);
    expect(
      (
        await service
          .from('generation_temporary_content')
          .update({
            created_at: new Date(Date.now() - 7200000).toISOString(),
            expires_at: new Date(Date.now() - 3600000).toISOString(),
          })
          .eq('generation_run_id', f.runId)
      ).error,
    ).toBeNull();
    expect(
      await store.finish(task, {
        status: 'COMPLETED',
        metrics: compareReplies(f.original, f.sent),
      }),
    ).toBe(true);
    expect((await feedback())[0]).toMatchObject({
      status: 'SKIPPED',
      reason_code: 'ORIGINAL_UNAVAILABLE',
      metrics: null,
    });
  });
  it('limita reintentos de proveedores sin transformar fallos en similitud cero', async () => {
    await enable();
    const f = await seed();
    f.gmail.getMessage.mockRejectedValue(
      new ProviderError('google', 'UNAVAILABLE'),
    );
    for (let n = 0; n < 5; n++) {
      await f.run();
      const [saved] = await feedback();
      if (n < 4)
        expect(
          (
            await service
              .from('feedback_events')
              .update({ next_attempt_at: '2000-01-01T00:00:00Z' })
              .eq('id', saved.id)
          ).error,
        ).toBeNull();
    }
    expect((await feedback())[0]).toMatchObject({
      status: 'SKIPPED',
      reason_code: 'RETRY_LIMIT',
      metrics: null,
      attempts: 5,
    });
  });
  it('rechaza campos de texto, métricas incoherentes y aprendizaje factual también en SQL', async () => {
    await enable();
    const f = await seed(),
      task = await taskFor(f.attempt.id),
      metrics = compareReplies(f.original, f.sent);
    const args = {
      p_user_id: userId,
      p_account_id: accountId,
      p_feedback_id: task.id,
      p_lease_id: task.leaseId,
    };
    expect(
      (
        await service.rpc('finish_reply_comparison', {
          ...args,
          p_result: {
            status: 'COMPLETED',
            metrics: { ...metrics, bodyText: 'PRIVATE_EMAIL' },
          },
        })
      ).error?.message,
    ).toBe('INVALID_COMPARISON_RESULT');
    for (const change of [
      { editDistance: 12 },
      { classification: 'FACTUAL_REVIEW', learningEligible: true },
      { learningEligible: true },
    ])
      expect(
        (
          await service.rpc('finish_reply_comparison', {
            ...args,
            p_result: {
              status: 'COMPLETED',
              metrics: { ...metrics, ...change },
            },
          })
        ).error,
      ).not.toBeNull();
    expect(await store.finish(task, { status: 'COMPLETED', metrics })).toBe(
      true,
    );
    expect(
      (
        await service
          .from('feedback_events')
          .update({ metrics: { ...metrics, similarity: 0 } })
          .eq('id', task.id)
      ).error?.message,
    ).toBe('IMMUTABLE_FEEDBACK_RESULT');
  });
  it('el navegador solo consulta feedback y agregados propios, sin contenido ni funciones privilegiadas', async () => {
    await enable();
    const f = await seed();
    await f.run();
    const browser = createClient<Database>(
      process.env.AUTO_EMAIL_TEST_URL!,
      process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(
      (await browser.auth.signInWithPassword({ email, password })).error,
    ).toBeNull();
    expect(
      (await browser.from('feedback_events').select('id,status,metrics')).data,
    ).toHaveLength(1);
    expect(
      (await browser.from('reply_comparison_daily').select('*')).data,
    ).toHaveLength(1);
    expect((await browser.rpc('claim_reply_comparisons')).error).not.toBeNull();
    expect(
      (await browser.from('feedback_events').select('lease_id')).error,
    ).not.toBeNull();
    await browser.auth.signOut();
    const other = await service.auth.admin.getUserById(otherUserId);
    expect(
      (
        await browser.auth.signInWithPassword({
          email: other.data.user!.email!,
          password,
        })
      ).error,
    ).toBeNull();
    expect(
      (await browser.from('feedback_events').select('id,status,metrics')).data,
    ).toEqual([]);
    expect(
      (await browser.from('reply_comparison_daily').select('*')).data,
    ).toEqual([]);
    await browser.auth.signOut();
  });
  it('un usuario ajeno o desconectado no puede leer el original ni completar feedback', async () => {
    await enable();
    const f = await seed(),
      task = await taskFor(f.attempt.id);
    expect(
      await store.loadOriginal({ ...task, userId: otherUserId }),
    ).toBeNull();
    expect(
      await store.finish(
        { ...task, userId: otherUserId },
        { status: 'COMPLETED', metrics: compareReplies(f.original, f.sent) },
      ),
    ).toBe(false);
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'DISCONNECTED' })
          .eq('id', accountId)
      ).error,
    ).toBeNull();
    expect(await store.loadOriginal(task)).toBeNull();
    expect(
      await store.finish(task, {
        status: 'COMPLETED',
        metrics: compareReplies(f.original, f.sent),
      }),
    ).toBe(false);
  });
  it('el borrado del perfil elimina los indicadores de aprendizaje previos', async () => {
    await enable();
    const f = await seed();
    await f.run();
    expect(await feedback()).toHaveLength(1);
    expect(
      (await service.rpc('delete_writing_identity', { p_user_id: userId }))
        .error,
    ).toBeNull();
    expect(await feedback()).toEqual([]);
  });
});
