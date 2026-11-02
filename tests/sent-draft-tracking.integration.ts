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
import { createSentDraftTrackingStore } from '@/db/sent-draft-tracking';
import { createInterventionHistoryRepository } from '@/db/intervention-history';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { runSentDraftTracking } from '@/worker/sent-draft-tracking';
import { sentDraftFixture, withSentHeader } from './fixtures/sent-drafts';
import { responsePromptVersion } from '@/modules/response/prompts';
import type { SentTrackingAttempt } from '@/modules/gmail/sent-draft-tracking';
const service = createClient<Database>(
  process.env.AUTO_EMAIL_TEST_URL!,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const store = createSentDraftTrackingStore(service);
let userId = '',
  otherUserId = '',
  accountId = '',
  email = '';
const password = `Mail57-${crypto.randomUUID()}!`;
async function row(id: string) {
  const result = await service
    .from('draft_generations')
    .select('*')
    .eq('id', id)
    .single();
  expect(result.error).toBeNull();
  return result.data!;
}
async function seed(
  status: 'CREATED' | 'UNCERTAIN' | 'CANCELLED' = 'CREATED',
  threadId = 'thread57',
) {
  const f = sentDraftFixture();
  Object.assign(f.attempt, {
    userId,
    gmailAccountId: accountId,
    threadId,
    status,
    targetMessageId: threadId === 'thread57' ? 'incoming57' : 'incomingOther57',
  });
  if (status === 'UNCERTAIN') f.attempt.draftId = null;
  if (status === 'CANCELLED') {
    f.attempt.draftId = null;
    f.attempt.writeStartedAt = null;
  }
  const result = await service.from('draft_generations').insert({
    id: f.attempt.id,
    user_id: userId,
    gmail_account_id: accountId,
    thread_id: threadId,
    target_message_id: f.attempt.targetMessageId,
    status,
    draft_id: f.attempt.draftId,
    draft_message_id: status === 'CREATED' ? 'draftMessage57' : null,
    reason_code:
      status === 'UNCERTAIN'
        ? 'GMAIL_WRITE_UNCERTAIN'
        : status === 'CANCELLED'
          ? 'PREWRITE_FAILED'
          : null,
    style_revision: crypto.randomUUID(),
    model: 'test-model',
    prompt_version: responsePromptVersion,
    input_tokens: 100,
    output_tokens: 30,
    write_started_at: f.attempt.writeStartedAt,
    delivery_intent: f.attempt.intent,
    delivery_envelope_hash: f.attempt.envelopeHash,
    draft_internet_message_id: f.attempt.draftInternetMessageId,
    created_at: new Date(f.writeAt - 10000).toISOString(),
    sent_next_check_at: '2000-01-01T00:00:00Z',
  });
  expect(result.error).toBeNull();
  return {
    ...f,
    run: async () =>
      runSentDraftTracking(
        { store, gmailFor: async () => f.gmail, report: vi.fn() },
        100,
      ),
  };
}
async function claim(id: string): Promise<SentTrackingAttempt> {
  const attempts = await store.claim(100),
    found = attempts.find((a) => a.id === id);
  expect(found).toBeDefined();
  return found!;
}
async function due(id: string) {
  expect(
    (
      await service
        .from('draft_generations')
        .update({ sent_next_check_at: '2000-01-01T00:00:00Z' })
        .eq('id', id)
    ).error,
  ).toBeNull();
}
describe('MAIL-057 seguimiento de envíos con Supabase real', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const address = `mail57-${crypto.randomUUID()}@example.invalid`;
      const created = await createAuthorizedTestUser(service, {
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
    expect(
      (await service.from('draft_generations').delete().eq('user_id', userId))
        .error,
    ).toBeNull();
  });
  afterAll(async () => {
    for (const id of [userId, otherUserId])
      if (id)
        expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
  });
  it('guarda el ID SENT nuevo y sus evidencias sin cuerpos, sin modificar la escritura original', async () => {
    const f = await seed();
    await f.run();
    const saved = await row(f.attempt.id);
    expect(saved.sent_outcome).toMatchObject({
      status: 'SENT',
      reason: 'MATCHED_MARKER',
      messageId: 'sent57',
    });
    expect(saved).toMatchObject({
      status: 'CREATED',
      draft_id: 'draft57',
      draft_message_id: 'draftMessage57',
      sent_lease_id: null,
    });
    expect(JSON.stringify(saved)).not.toContain(f.body);
    expect((await store.claim(100)).some((a) => a.id === f.attempt.id)).toBe(
      false,
    );
  });
  it('una ausencia queda indeterminada y admite una confirmación posterior', async () => {
    const f = await seed();
    f.state.sent = [];
    await f.run();
    expect((await row(f.attempt.id)).sent_outcome).toMatchObject({
      status: 'INDETERMINATE',
      reason: 'MISSING_DRAFT',
    });
    f.state.sent = [f.sent];
    await due(f.attempt.id);
    await f.run();
    expect((await row(f.attempt.id)).sent_outcome).toMatchObject({
      status: 'SENT',
    });
  });
  it('resuelve un envío tras respuesta perdida y libera el hilo manteniendo la idempotencia del mensaje original', async () => {
    const f = await seed('UNCERTAIN');
    await f.run();
    expect((await row(f.attempt.id)).sent_outcome).toMatchObject({
      status: 'SENT',
    });
    const history = await createInterventionHistoryRepository(
      service,
      userId,
      accountId,
    ).forThread('thread57');
    expect(history[0].status).toBe('CREATED');
    const drafts = createDraftGenerationRepository(service, userId, accountId);
    expect(await drafts.find('incoming57')).toMatchObject({ sent: true });
    expect(
      (
        await drafts.reserve({
          id: crypto.randomUUID(),
          threadId: 'thread57',
          targetMessageId: 'nextIncoming57',
          styleRevision: crypto.randomUUID(),
          model: 'test-model',
          inputTokens: 1,
          outputTokens: 1,
        })
      ).acquired,
    ).toBe(true);
  });
  it('distingue una respuesta independiente y sigue comprobando si después se envía la generación', async () => {
    const f = await seed();
    f.state.draftPresent = true;
    f.state.sent = [
      {
        ...withSentHeader(
          withSentHeader(f.sent, 'X-Auto-Email-Attempt', null),
          'Message-ID',
          '<manual@example.invalid>',
        ),
        id: 'manual57',
      },
    ];
    await f.run();
    expect((await row(f.attempt.id)).sent_outcome).toMatchObject({
      status: 'MANUAL_REPLY',
      messageId: 'manual57',
    });
    f.state.draftPresent = false;
    f.state.sent = [f.sent];
    await due(f.attempt.id);
    await f.run();
    expect((await row(f.attempt.id)).sent_outcome).toMatchObject({
      status: 'SENT',
      messageId: 'sent57',
    });
  });
  it('dos workers no adquieren el mismo intento y los leases caducados no pueden escribir', async () => {
    const f = await seed();
    const sets = await Promise.all([store.claim(100), store.claim(100)]);
    const matches = sets.flat().filter((a) => a.id === f.attempt.id);
    expect(matches).toHaveLength(1);
    const old = matches[0];
    expect(
      (
        await service
          .from('draft_generations')
          .update({ sent_lease_expires_at: '2000-01-01T00:00:00Z' })
          .eq('id', old.id)
      ).error,
    ).toBeNull();
    const fresh = await claim(old.id);
    expect(fresh.leaseId).not.toBe(old.leaseId);
    const outcome = {
      outcome: {
        status: 'INDETERMINATE' as const,
        reason: 'MISSING_DRAFT' as const,
      },
    };
    expect(await store.finish(old, outcome)).toBe(false);
    expect(await store.finish(fresh, outcome)).toBe(true);
  });
  it('rechaza propietarios incorrectos y una desconexión posterior a adquirir el trabajo', async () => {
    const f = await seed(),
      attempt = await claim(f.attempt.id);
    const outcome = {
      outcome: {
        status: 'INDETERMINATE' as const,
        reason: 'MISSING_DRAFT' as const,
      },
    };
    expect(
      await store.finish({ ...attempt, userId: otherUserId }, outcome),
    ).toBe(false);
    expect(
      (
        await service
          .from('gmail_accounts')
          .update({ status: 'DISCONNECTED' })
          .eq('id', accountId)
      ).error,
    ).toBeNull();
    expect(await store.finish(attempt, outcome)).toBe(false);
    expect((await row(attempt.id)).sent_outcome).toMatchObject({
      status: 'PENDING',
    });
  });
  it('impide que un mismo mensaje enviado se asocie a dos generaciones', async () => {
    const first = await seed('UNCERTAIN');
    await first.run();
    const second = await seed('UNCERTAIN', 'threadOther57'),
      attempt = await claim(second.attempt.id);
    expect(
      await store.finish(attempt, {
        outcome: {
          status: 'SENT',
          reason: 'MATCHED_MARKER',
          messageId: 'sent57',
          sentAt: new Date(second.writeAt + 60000).toISOString(),
        },
      }),
    ).toBe(true);
    expect((await row(second.attempt.id)).sent_outcome).toMatchObject({
      status: 'INDETERMINATE',
      reason: 'ALREADY_ASSOCIATED',
    });
    expect((await row(first.attempt.id)).sent_outcome).toMatchObject({
      status: 'SENT',
    });
  });
  it('una cancelación conocida previa a escribir se descarta sin acceder a Gmail', async () => {
    const f = await seed('CANCELLED');
    await f.run();
    expect((await row(f.attempt.id)).sent_outcome).toEqual({
      status: 'DISCARDED',
      reason: 'WRITE_CANCELLED',
    });
    expect(f.gmail.getThread).not.toHaveBeenCalled();
  });
  it('valida fechas y esquema también en SQL, y conserva como terminal un envío confirmado', async () => {
    const f = await seed(),
      attempt = await claim(f.attempt.id);
    const args = {
      p_user_id: userId,
      p_account_id: accountId,
      p_attempt_id: attempt.id,
      p_lease_id: attempt.leaseId,
    };
    for (const sentAt of [
      new Date(f.writeAt - 60000).toISOString(),
      new Date(Date.now() + 600000).toISOString(),
    ])
      expect(
        (
          await service.rpc('finish_sent_draft_tracking', {
            ...args,
            p_outcome: {
              status: 'SENT',
              reason: 'MATCHED_MARKER',
              messageId: 'sent57',
              sentAt,
            },
          })
        ).error?.message,
      ).toBe('INVALID_SENT_OUTCOME');
    expect(
      (
        await service.rpc('finish_sent_draft_tracking', {
          ...args,
          p_outcome: {
            status: 'INDETERMINATE',
            reason: 'MISSING_DRAFT',
            bodyText: 'PRIVATE_CONTENT',
          },
        })
      ).error?.message,
    ).toBe('INVALID_SENT_OUTCOME');
    expect(
      await store.finish(attempt, {
        outcome: {
          status: 'SENT',
          reason: 'MATCHED_MARKER',
          messageId: 'sent57',
          sentAt: new Date(f.writeAt + 60000).toISOString(),
        },
      }),
    ).toBe(true);
    expect(
      (
        await service
          .from('draft_generations')
          .update({
            sent_outcome: { status: 'PENDING', reason: 'NOT_CHECKED' },
          })
          .eq('id', attempt.id)
      ).error?.message,
    ).toBe('IMMUTABLE_SENT_OUTCOME');
  });
  it('expone solo el resultado propio al navegador y mantiene privadas las RPC y la huella de destinatarios', async () => {
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
    const own = await browser
      .from('draft_generations')
      .select('id,sent_outcome')
      .eq('user_id', userId);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect(
      (await browser.from('draft_generations').select('delivery_envelope_hash'))
        .error,
    ).not.toBeNull();
    expect(
      (await browser.rpc('claim_sent_draft_tracking')).error,
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
      (await browser.from('draft_generations').select('id,sent_outcome')).data,
    ).toEqual([]);
    await browser.auth.signOut();
  });
});
