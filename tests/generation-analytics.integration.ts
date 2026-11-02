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
import type { Database } from '@/db/database.types';
import { createGenerationRecorder } from '@/db/generation-runs';
import { createGenerationRetentionRepository } from '@/db/generation-retention';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { createReplyOrchestrator } from '@/modules/response/orchestrator';
import { createResponseGenerator } from '@/modules/response/generator';
import { draftFixture } from './fixtures/drafts';
import { createResponsePolicyRepository } from '@/db/response-policy';

const url = process.env.AUTO_EMAIL_TEST_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const password = `Generation56-${crypto.randomUUID()}!`;
const users: string[] = [];
let accountId = '',
  email = '';
const owner = () => ({ userId: users[0], gmailAccountId: accountId });
const retention = () => createGenerationRetentionRepository(service, users[0]);
function fixture(
  options: {
    failed?: boolean;
    missing?: boolean;
    consume?: Parameters<
      ReturnType<typeof createReplyOrchestrator>['generate']
    >[0]['consume'];
  } = {},
) {
  const f = draftFixture();
  if (options.failed)
    f.text.generate.mockRejectedValue(new Error('PRIVATE_ERROR_PAYLOAD'));
  const recorder = createGenerationRecorder(
    service,
    owner(),
    { id: f.model, reasoningEffort: 'none', maxOutputTokens: 2048 },
    { inputUsdPerMillion: 1.5, outputUsdPerMillion: 6 },
  );
  const orchestration = createReplyOrchestrator({
    gmail: f.gmail,
    generator: createResponseGenerator(f.text),
    styleExamples: { retrieve: vi.fn().mockResolvedValue([]) },
    policy: createResponsePolicyRepository(service, users[0]).forAccount(
      accountId,
    ),
    generations: recorder,
  });
  return {
    ...f,
    run: () =>
      orchestration.generate({
        selection: {
          ...f.selection,
          accountId,
          ...(options.missing
            ? { style: undefined, resolveStyle: async () => null }
            : {}),
        },
        userInstructions: ['No uses saludos largos'],
        consume: options.consume,
      }),
  };
}
async function runs() {
  const result = await service
    .from('generation_runs')
    .select('*')
    .eq('user_id', users[0])
    .order('generation_version');
  expect(result.error).toBeNull();
  return result.data!;
}
async function contents() {
  const result = await service
    .from('generation_temporary_content')
    .select('*')
    .eq('user_id', users[0]);
  expect(result.error).toBeNull();
  return result.data!;
}
async function enable(hours = 24) {
  await retention().set({
    accountId,
    enabled: true,
    retentionHours: hours,
    noticeVersion: 'mail056-v1',
  });
}
describe('MAIL-056 generaciones y conservación con Supabase real', () => {
  beforeAll(async () => {
    for (let n = 0; n < 2; n++) {
      const address = `generation56-${crypto.randomUUID()}@example.invalid`;
      const created = await createAuthorizedTestUser(service, {
        email: address,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      users.push(created.data.user!.id);
      if (!n) email = address;
    }
    const account = await service
      .from('gmail_accounts')
      .insert({
        user_id: users[0],
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
      (await service.from('draft_generations').delete().eq('user_id', users[0]))
        .error,
    ).toBeNull();
    expect(
      (await service.from('generation_runs').delete().eq('user_id', users[0]))
        .error,
    ).toBeNull();
  });
  afterAll(async () => {
    for (const id of users)
      expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
  });
  it('guarda versiones, configuración y consumo sin contenido por defecto, y enlaza el draft', async () => {
    const store = createDraftGenerationRepository(service, users[0], accountId);
    const f = fixture({
      consume: async (response, context) => {
        const reservation = await store.reserve({
          id: crypto.randomUUID(),
          generationRunId: response.generationRunId,
          threadId: context.threadId,
          targetMessageId: context.targetMessageId,
          styleRevision: context.styleRevision!,
          model: 'test-model',
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        });
        await store.created(reservation.record.id, 'draft56', 'draftMessage56');
      },
    });
    const result = await f.run();
    const [run] = await runs();
    expect(run).toMatchObject({
      id: result.reply!.generationRunId,
      generation_version: 1,
      status: 'READY',
      input_tokens: 200,
      output_tokens: 60,
      model_calls: 2,
      estimated_cost_usd: 0.00066,
    });
    expect(run.duration_ms).toBeGreaterThanOrEqual(0);
    expect(run.configuration).toMatchObject({
      version: 'mail056-v1',
      promptVersion: 'mail049-v1',
      style: f.selection.style.profile,
      policyRevision: expect.any(String),
      reasoningEffort: 'none',
      maxOutputTokens: 2048,
    });
    expect(JSON.stringify(run)).not.toContain(result.reply!.bodyText!);
    expect(JSON.stringify(run)).not.toContain('No uses saludos largos');
    expect(await contents()).toEqual([]);
    const draft = await service
      .from('draft_generations')
      .select('generation_run_id,draft_id,thread_id')
      .eq('user_id', users[0])
      .single();
    expect(draft.data).toMatchObject({
      generation_run_id: run.id,
      draft_id: 'draft56',
      thread_id: f.thread.id,
    });
  });
  it('versiona intentos concurrentes sin duplicar y registra abstenciones y fallos', async () => {
    await Promise.all([fixture().run(), fixture().run()]);
    const missing = await fixture({ missing: true }).run();
    expect(missing.reply?.status).toBe('INSUFFICIENT_CONTEXT');
    await expect(fixture({ failed: true }).run()).rejects.toThrow(
      'PRIVATE_ERROR_PAYLOAD',
    );
    const rows = await runs();
    expect(rows.map((r) => r.generation_version)).toEqual([1, 2, 3, 4]);
    expect(rows[2]).toMatchObject({
      status: 'INSUFFICIENT_CONTEXT',
      input_tokens: 0,
      model_calls: 0,
      estimated_cost_usd: 0,
    });
    expect(rows[3]).toMatchObject({
      status: 'FAILED',
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
    });
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_ERROR_PAYLOAD');
  });
  it('impide asociar un draft con otra configuración o mensaje', async () => {
    const f = fixture();
    const result = await f.run();
    const store = createDraftGenerationRepository(service, users[0], accountId);
    const base = {
      id: crypto.randomUUID(),
      generationRunId: result.reply!.generationRunId,
      threadId: f.thread.id,
      targetMessageId: f.thread.messages[0].id,
      styleRevision: f.selection.style.revision,
      model: f.model,
      inputTokens: 200,
      outputTokens: 60,
    };
    for (const change of [
      { model: 'another-model' },
      { targetMessageId: 'another-message' },
      { inputTokens: 201 },
      { styleRevision: crypto.randomUUID() },
    ])
      await expect(store.reserve({ ...base, ...change })).rejects.toMatchObject(
        { code: 'UNAVAILABLE' },
      );
    expect(
      (
        await service
          .from('draft_generations')
          .select('id')
          .eq('user_id', users[0])
      ).data,
    ).toEqual([]);
  });
  it('conserva con aceptación explícita, limita el plazo y purga al retirar permiso', async () => {
    await expect(
      retention().set({
        accountId,
        enabled: true,
        retentionHours: 169,
        noticeVersion: 'mail056-v1',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await enable();
    const response = await fixture().run();
    const [content] = await contents();
    expect(content.body_text).toBe(response.reply?.bodyText);
    expect(
      Date.parse(content.expires_at) - Date.parse(content.created_at),
    ).toBe(86400000);
    await enable(1);
    expect(
      Date.parse((await contents())[0].expires_at) -
        Date.parse(content.created_at),
    ).toBe(3600000);
    await enable(168);
    expect(
      Date.parse((await contents())[0].expires_at) -
        Date.parse(content.created_at),
    ).toBe(3600000);
    await retention().set({ accountId, enabled: false });
    expect(await contents()).toEqual([]);
    expect(await runs()).toHaveLength(1);
  });
  it('oculta contenido caducado antes de la purga y elimina solo las copias vencidas', async () => {
    await enable();
    await fixture().run();
    await fixture().run();
    const [old, fresh] = await contents();
    expect(
      (
        await service
          .from('generation_temporary_content')
          .update({
            created_at: new Date(Date.now() - 172800000).toISOString(),
            expires_at: new Date(Date.now() - 86400000).toISOString(),
          })
          .eq('generation_run_id', old.generation_run_id)
      ).error,
    ).toBeNull();
    expect(
      (
        await service.rpc('read_generation_content', {
          p_user_id: users[0],
          p_generation_run_id: old.generation_run_id,
        })
      ).data,
    ).toBeNull();
    expect((await service.rpc('purge_generation_content')).error).toBeNull();
    expect((await contents()).map((c) => c.generation_run_id)).toEqual([
      fresh.generation_run_id,
    ]);
    expect(await runs()).toHaveLength(2);
  });
  it('restringe metadatos al propietario y bloquea acceso público a contenido y RPC privilegiadas', async () => {
    await enable();
    const result = await fixture().run();
    const browser = createClient<Database>(
      url,
      process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(
      (await browser.auth.signInWithPassword({ email, password })).error,
    ).toBeNull();
    expect(
      (await browser.from('generation_runs').select('id')).data,
    ).toHaveLength(1);
    expect(
      (await browser.from('generation_temporary_content').select('*')).error,
    ).not.toBeNull();
    expect(
      (
        await browser.rpc('read_generation_content', {
          p_user_id: users[0],
          p_generation_run_id: result.reply!.generationRunId!,
        })
      ).error,
    ).not.toBeNull();
    await browser.auth.signOut();
    const other = await service.auth.admin.getUserById(users[1]);
    expect(
      (
        await browser.auth.signInWithPassword({
          email: other.data.user!.email!,
          password,
        })
      ).error,
    ).toBeNull();
    expect((await browser.from('generation_runs').select('id')).data).toEqual(
      [],
    );
    await expect(
      createGenerationRetentionRepository(service, users[1]).set({
        accountId,
        enabled: true,
        retentionHours: 24,
        noticeVersion: 'mail056-v1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (
        await service.rpc('read_generation_content', {
          p_user_id: users[1],
          p_generation_run_id: result.reply!.generationRunId!,
        })
      ).data,
    ).toBeNull();
    await browser.auth.signOut();
  });
  it('el borrado del perfil suprime sus copias históricas y conserva solo la trazabilidad técnica', async () => {
    await enable();
    await fixture().run();
    const [before] = await runs();
    expect(
      (await service.rpc('delete_writing_identity', { p_user_id: users[0] }))
        .error,
    ).toBeNull();
    const [after] = await runs();
    expect(after).toMatchObject({
      id: before.id,
      input_tokens: before.input_tokens,
      output_tokens: before.output_tokens,
      model: before.model,
    });
    expect(after.configuration).toMatchObject({
      style: null,
      preferences: [],
      preferenceRevisions: [],
      userInstructionsHash: null,
    });
    expect(await contents()).toEqual([]);
    expect(
      (
        await service
          .from('generation_runs')
          .update({ configuration: before.configuration })
          .eq('id', before.id)
      ).error?.message,
    ).toContain('GENERATION_IMMUTABLE');
  });
  it('retira la autorización y elimina copias al desconectar Gmail', async () => {
    await enable();
    await fixture().run();
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'DISCONNECTED' })
          .eq('id', accountId)
      ).error,
    ).toBeNull();
    expect(await contents()).toEqual([]);
    expect(
      (
        await service
          .from('generation_content_authorizations')
          .select('*')
          .eq('user_id', users[0])
      ).data,
    ).toEqual([]);
    expect(await runs()).toHaveLength(1);
  });
  it('elimina las copias al solicitar la eliminación de la cuenta', async () => {
    await enable();
    await fixture().run();
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DELETION_PENDING' })
          .eq('id', users[0])
      ).error,
    ).toBeNull();
    expect(await contents()).toEqual([]);
    expect(
      (
        await service
          .from('generation_content_authorizations')
          .select('*')
          .eq('user_id', users[0])
      ).data,
    ).toEqual([]);
  });
});
