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
import { createEmailJobStore } from '@/db/email-jobs';
import { createGmailSyncStore } from '@/db/gmail-sync';
import { gmailScopes } from '@/config/google';
import { runEmailJobCycle, type EmailJob } from '@/worker/email-jobs';
import { createAccountEmailClassifier } from '@/worker/email-classifier';
import { checkAccountEmailIntervention } from '@/worker/email-intervention';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { createInterventionHistoryRepository } from '@/db/intervention-history';
import { createEmailFixtures, type SyntheticThread } from './fixtures/emails';
import { runMailWorkerCycle } from '@/worker/pipeline';
import { readSyncConfig } from '@/worker/sync-config';
import type { EmailClassification } from '@/modules/classifier/contracts';
import { jobClassification } from '@/modules/workflow/email-job';
import { createEmailJobDraftWriter } from '@/worker/email-drafts';
import {
  selectPendingEmail,
  type PreparedReplyContext,
} from '@/modules/gmail/manual-selection';
import { draftFixture } from './fixtures/drafts';
import { readyResponse } from './fixtures/responses';
import { writingProfileRow } from './fixtures/writing-profile';
import {
  classifierMessage,
  classifierMetadata,
} from './fixtures/classifier-emails';

const service = createClient<Database>(
  process.env.AUTO_EMAIL_TEST_URL!,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const store = createEmailJobStore(service);
const config = { leaseSeconds: 300, maxJobsPerCycle: 20 };
const owners: { userId: string; gmailAccountId: string; email: string }[] = [];
const positive: EmailClassification = {
  decision: 'REPLY_REQUIRED',
  intent: 'REQUEST_INFORMATION',
  reasons: ['EXPLICIT_QUESTION'],
  explanation: 'Pregunta.',
  riskFlags: [],
  needsAttachment: false,
  source: 'MODEL',
  modelCalls: 1,
  inputTokens: 12,
  outputTokens: 4,
};
async function enable(index = 0) {
  expect(
    (
      await service
        .from('user_settings')
        .update({ automation_enabled: true })
        .eq('user_id', owners[index].userId)
    ).error,
  ).toBeNull();
}
async function enqueue(id = 'm1', index = 0) {
  const owner = owners[index];
  const result = await service.from('gmail_sync_messages').upsert(
    {
      user_id: owner.userId,
      gmail_account_id: owner.gmailAccountId,
      message_id: id,
      thread_id: `t_${id}`,
    },
    { onConflict: 'gmail_account_id,message_id', ignoreDuplicates: true },
  );
  expect(result.error).toBeNull();
  await makeJobsDue(index);
}
async function makeJobsDue(index = 0) {
  // Concurrency tests need due work even if Docker adjusts its wall clock.
  expect(
    (
      await service
        .from('email_jobs')
        .update({ available_at: '2000-01-01T00:00:00Z' })
        .eq('user_id', owners[index].userId)
        .eq('status', 'PENDING')
    ).error,
  ).toBeNull();
}
async function claim(includeGeneration = false): Promise<EmailJob> {
  const job = await store.claim(300, includeGeneration);
  expect(job).not.toBeNull();
  return job!;
}
async function saved(id: string) {
  const result = await service
    .from('email_jobs')
    .select('*')
    .eq('id', id)
    .single();
  expect(result.error).toBeNull();
  return result.data!;
}
async function expire(job: EmailJob) {
  expect(
    (
      await service
        .from('email_jobs')
        .update({ lease_expires_at: '2000-01-01T00:00:00Z' })
        .eq('id', job.id)
        .eq('user_id', job.userId)
    ).error,
  ).toBeNull();
}

async function preparedDraft() {
  const f = draftFixture();
  const target = f.thread.messages[0].id;
  await enqueue(target);
  await enable();
  const job = await claim();
  await store.advance(job, {
    status: 'GENERATING',
    classification: jobClassification(positive),
  });
  const thread = {
    ...f.thread,
    id: job.threadId,
    messages: f.thread.messages.map((message) => ({
      ...message,
      threadId: job.threadId,
      payload: {
        ...message.payload,
        headers: message.payload!.headers!.map((header) =>
          header.name === 'To' ? { ...header, value: owners[0].email } : header,
        ),
      },
    })),
  };
  const selection = {
    ...f.selection,
    accountId: job.gmailAccountId,
    mailboxAddress: owners[0].email,
    threadId: job.threadId,
  };
  f.gmail.getThread.mockResolvedValue(thread);
  let context!: PreparedReplyContext;
  await selectPendingEmail(f.gmail, selection, async (value) => {
    context = structuredClone(value);
  });
  return {
    ...f,
    thread,
    selection,
    job,
    options: {
      selection,
      context,
      model: f.model,
      response: {
        ...readyResponse(),
        modelCalls: 2,
        examplesUsed: 0,
        inputTokens: 100,
        outputTokens: 30,
      },
    },
  };
}

describe('MAIL-031 cola con PostgreSQL real', () => {
  it('MAIL-034: un cambio durante generación cancela el borrador y deja el trabajo terminal con su causa', async () => {
    const f = await preparedDraft();
    const result = await runEmailJobCycle(
      {
        store,
        inspect: async () => ({ status: 'CONTINUE' }),
        classifierFor: async () => {
          throw new Error('No debe clasificar otra vez');
        },
        generate: async (job, control) => {
          f.gmail.getThread.mockResolvedValue({
            ...f.thread,
            historyId: 'changed34',
          });
          return createEmailJobDraftWriter({
            client: service,
            gmail: f.gmail,
            job,
            ...control,
          }).create(f.options);
        },
        report: vi.fn(),
      },
      config,
    );
    expect(result).toMatchObject({
      claimed: 1,
      reviewRequired: 1,
      draftsCreated: 0,
    });
    expect(f.gmail.createDraft).toHaveBeenCalledOnce();
    const job = await saved(f.job.id);
    expect(job).toMatchObject({
      status: 'REVIEW_REQUIRED',
      reason_code: 'THREAD_CHANGED',
      lease_id: null,
    });
    expect(job.classification).toEqual(jobClassification(positive));
    const attempts = await service
      .from('draft_generations')
      .select('status,write_started_at,reason_code')
      .eq('user_id', f.job.userId);
    expect(attempts.error).toBeNull();
    expect(attempts.data).toEqual([
      {
        status: 'CANCELLED',
        write_started_at: null,
        reason_code: 'THREAD_CHANGED',
      },
    ]);
    expect(await store.claim(300, true)).toBeNull();
  });
  it('MAIL-034: la escritura validada registra inicio, IDs y estado final sin repetir el borrador', async () => {
    const f = await preparedDraft();
    const result = await runEmailJobCycle(
      {
        store,
        inspect: async () => ({ status: 'CONTINUE' }),
        classifierFor: async () => {
          throw new Error('No debe clasificar otra vez');
        },
        generate: async (job, control) =>
          createEmailJobDraftWriter({
            client: service,
            gmail: f.gmail,
            job,
            ...control,
          }).create(f.options),
        report: vi.fn(),
      },
      config,
    );
    expect(result).toMatchObject({ draftsCreated: 1, failed: 0 });
    expect(await saved(f.job.id)).toMatchObject({
      status: 'DRAFT_CREATED',
      draft_id: 'r-draft-21',
    });
    const attempt = await service
      .from('draft_generations')
      .select('status,write_started_at,draft_id')
      .eq('user_id', f.job.userId)
      .single();
    expect(attempt.error).toBeNull();
    expect(attempt.data).toMatchObject({
      status: 'CREATED',
      draft_id: 'r-draft-21',
    });
    expect(attempt.data!.write_started_at).not.toBeNull();
    expect(f.gmail.createDraft).toHaveBeenCalledOnce();
    expect(await store.claim(300, true)).toBeNull();
  });
  it.each(['lease', 'automation'] as const)(
    'MAIL-034: la base rechaza escritura si cambia %s antes del POST',
    async (change) => {
      const f = await preparedDraft();
      const job = await claim(true);
      const create = f.gmail.createDraft.getMockImplementation()!;
      f.gmail.createDraft.mockImplementation(async (message, guard) => {
        await guard!.prepare();
        if (change === 'lease') await expire(job);
        else
          expect(
            (
              await service
                .from('user_settings')
                .update({ automation_enabled: false })
                .eq('user_id', job.userId)
            ).error,
          ).toBeNull();
        // Deliberately omit the heartbeat check: the database fence must suffice.
        return create(message, {
          prepare: async () => {},
          beforeRequest: guard!.beforeRequest,
        });
      });
      const result = await createEmailJobDraftWriter({
        client: service,
        gmail: f.gmail,
        job,
        assertLease: async () => {},
      }).create(f.options);
      expect(result).toEqual({
        status: 'REVIEW_REQUIRED',
        reasonCode: 'PREWRITE_FAILED',
      });
      const attempt = await service
        .from('draft_generations')
        .select('status,write_started_at')
        .eq('user_id', job.userId)
        .single();
      expect(attempt.error).toBeNull();
      expect(attempt.data).toEqual({
        status: 'CANCELLED',
        write_started_at: null,
      });
      expect(f.gmail.getMessage).not.toHaveBeenCalled();
    },
  );
  it('MAIL-034: solo un proceso puede consumir el permiso de escritura en PostgreSQL', async () => {
    const owner = owners[0];
    const repo = createDraftGenerationRepository(
      service,
      owner.userId,
      owner.gmailAccountId,
    );
    const id = crypto.randomUUID();
    expect(
      await repo.reserve({
        id,
        threadId: 'thread34',
        targetMessageId: 'target34',
        styleRevision: writingProfileRow().revision,
        model: 'test-model',
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toMatchObject({ acquired: true });
    const permits = await Promise.all(
      Array.from({ length: 5 }, () =>
        repo.beginWrite(id, 'thread34', 'target34'),
      ),
    );
    expect(permits.filter(Boolean)).toHaveLength(1);
    expect(await repo.beginWrite(id, 'thread34', 'target34')).toBe(false);
  });
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `mail031-${crypto.randomUUID()}@example.invalid`;
      const user = await service.auth.admin.createUser({
        email,
        password: 'Mail031-Synthetic-Password!',
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      const owner = { userId: user.data.user!.id, gmailAccountId: '', email };
      owners.push(owner);
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: owner.userId,
          email,
          status: 'CONNECTED',
          scope_set: [...gmailScopes],
          encrypted_refresh_token: `\\x${'01'.repeat(40)}`,
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owner.gmailAccountId = account.data!.id;
    }
  });
  beforeEach(async () => {
    for (const owner of owners) {
      expect(
        (
          await service
            .from('draft_generations')
            .delete()
            .eq('user_id', owner.userId)
        ).error,
      ).toBeNull();
      expect(
        (await service.from('email_jobs').delete().eq('user_id', owner.userId))
          .error,
      ).toBeNull();
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
            .from('users')
            .update({ status: 'ACTIVE' })
            .eq('id', owner.userId)
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
              next_sync_at: '2000-01-01T00:00:00Z',
              sync_lease_id: null,
              sync_lease_expires_at: null,
              sync_window_start_at: null,
            })
            .eq('id', owner.gmailAccountId)
            .eq('user_id', owner.userId)
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

  function interventionFixture(kind: 'manualDraft' | 'answered' | 'pending') {
    const thread = createEmailFixtures()[kind];
    for (const message of thread.messages)
      for (const header of message.payload.headers)
        header.value = header.value.replaceAll(
          'owner@example.invalid',
          owners[0].email,
        );
    const gmail = { getThread: vi.fn(async () => thread), get: vi.fn() };
    const classify = vi.fn(async () => positive);
    const deps = {
      store,
      inspect: (job: EmailJob) =>
        checkAccountEmailIntervention({ client: service, job, gmail }),
      classifierFor: vi.fn(async () => ({ classify })),
      report: vi.fn(),
    };
    return { thread, gmail, classify, deps };
  }
  async function queueThread(thread: SyntheticThread) {
    expect(
      (
        await service.from('gmail_sync_messages').insert({
          user_id: owners[0].userId,
          gmail_account_id: owners[0].gmailAccountId,
          message_id: thread.messages[0].id,
          thread_id: thread.id,
        })
      ).error,
    ).toBeNull();
    await makeJobsDue();
    await enable();
  }
  async function previousDraft(
    thread: SyntheticThread,
    status: 'CREATED' | 'UNCERTAIN' = 'CREATED',
  ) {
    const drafts = createDraftGenerationRepository(
      service,
      owners[0].userId,
      owners[0].gmailAccountId,
    );
    const id = crypto.randomUUID();
    await drafts.reserve({
      id,
      threadId: thread.id,
      targetMessageId: thread.messages[0].id,
      styleRevision: crypto.randomUUID(),
      model: 'synthetic',
      inputTokens: 0,
      outputTokens: 0,
    });
    if (status === 'CREATED')
      await drafts.created(id, 'stable_draft32', 'old_message32');
    else await drafts.stop(id, 'UNCERTAIN', 'GMAIL_WRITE_UNCERTAIN');
  }
  it.each([
    { kind: 'manualDraft', reasonCode: 'EXISTING_MANUAL_DRAFT' },
    { kind: 'answered', reasonCode: 'ALREADY_ANSWERED' },
  ] as const)(
    'MAIL-032 omite $kind sin llamar al modelo y registra $reasonCode',
    async ({ kind, reasonCode }) => {
      const f = interventionFixture(kind);
      await queueThread(f.thread);
      expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
        skipped: 1,
        classified: 0,
        failed: 0,
      });
      expect(f.classify).not.toHaveBeenCalled();
      const row = await service
        .from('email_jobs')
        .select('id,status,reason_code,classification')
        .eq('user_id', owners[0].userId)
        .single();
      expect(row.data).toMatchObject({
        status: 'SKIPPED',
        reason_code: reasonCode,
        classification: null,
      });
      const events = await service
        .from('email_job_events')
        .select('to_status,reason_code')
        .eq('email_job_id', row.data!.id)
        .order('id');
      expect(events.data!.at(-1)).toEqual({
        to_status: 'SKIPPED',
        reason_code: reasonCode,
      });
      await runEmailJobCycle(f.deps, config);
      expect(f.gmail.getThread).toHaveBeenCalledOnce();
    },
  );
  it('MAIL-032 reconoce borradores editados usando el ID estable del registro persistido', async () => {
    const f = interventionFixture('manualDraft');
    await previousDraft(f.thread);
    f.gmail.get.mockResolvedValue({
      id: 'stable_draft32',
      message: { id: f.thread.messages[1].id, threadId: f.thread.id },
    });
    await queueThread(f.thread);
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      skipped: 1,
      classified: 0,
    });
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SKIPPED',
        reasonCode: 'EXISTING_SYSTEM_DRAFT',
      }),
    );
    expect(f.gmail.get).toHaveBeenCalledExactlyOnceWith(
      'drafts/stable_draft32',
      { format: 'minimal' },
    );
  });
  it('MAIL-032 no repite un borrador previamente creado aunque el usuario lo haya eliminado', async () => {
    const f = interventionFixture('pending');
    await previousDraft(f.thread);
    await queueThread(f.thread);
    const result = await runEmailJobCycle(f.deps, config);
    expect(result, JSON.stringify(f.deps.report.mock.calls)).toMatchObject({
      skipped: 1,
      classified: 0,
    });
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'TARGET_ALREADY_PROCESSED' }),
    );
    expect(f.classify).not.toHaveBeenCalled();
  });
  it('MAIL-032 reconoce también los borradores confirmados por la cola de trabajos', async () => {
    const f = interventionFixture('manualDraft');
    expect(
      (
        await service.from('gmail_sync_messages').insert({
          user_id: owners[0].userId,
          gmail_account_id: owners[0].gmailAccountId,
          message_id: 'earlier_target32',
          thread_id: f.thread.id,
        })
      ).error,
    ).toBeNull();
    await enable();
    const previous = await claim();
    await store.advance(previous, {
      status: 'GENERATING',
      classification: jobClassification(positive),
    });
    const generating = await claim(true);
    await store.advance(generating, {
      status: 'DRAFT_CREATED',
      draftId: 'stable_draft32',
    });
    f.gmail.get.mockResolvedValue({
      id: 'stable_draft32',
      message: { id: f.thread.messages[1].id, threadId: f.thread.id },
    });
    await queueThread(f.thread);
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      skipped: 1,
      classified: 0,
      failed: 0,
    });
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SKIPPED',
        reasonCode: 'EXISTING_SYSTEM_DRAFT',
      }),
    );
    expect(f.classify).not.toHaveBeenCalled();
  });
  it('MAIL-032 lleva una escritura sin confirmar a revisión sin repetirla', async () => {
    const f = interventionFixture('pending');
    await previousDraft(f.thread, 'UNCERTAIN');
    await queueThread(f.thread);
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      reviewRequired: 1,
      failed: 0,
      classified: 0,
    });
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'DRAFT_RECONCILIATION_REQUIRED' }),
    );
    expect(f.classify).not.toHaveBeenCalled();
  });
  it('MAIL-032 conserva la clasificación si aparece un borrador antes de reanudar GENERATING', async () => {
    const f = interventionFixture('manualDraft');
    await queueThread(f.thread);
    const job = await claim();
    await store.advance(job, {
      status: 'GENERATING',
      classification: jobClassification(positive),
    });
    const generate = vi.fn(async () => ({
      status: 'DRAFT_CREATED' as const,
      draftId: 'must_not_write',
    }));
    expect(
      await runEmailJobCycle({ ...f.deps, generate }, config),
    ).toMatchObject({ skipped: 1, classified: 0, draftsCreated: 0, failed: 0 });
    expect(generate).not.toHaveBeenCalled();
    expect(await saved(job.id)).toMatchObject({
      status: 'SKIPPED',
      reason_code: 'EXISTING_MANUAL_DRAFT',
      classification: jobClassification(positive),
    });
  });
  it('MAIL-032 limita el historial al propietario y la cuenta y rechaza trabajos cruzados antes de acceder a Gmail', async () => {
    const f = interventionFixture('manualDraft');
    await previousDraft(f.thread);
    expect(
      await createInterventionHistoryRepository(
        service,
        owners[1].userId,
        owners[1].gmailAccountId,
      ).forThread(f.thread.id),
    ).toEqual([]);
    await queueThread(f.thread);
    const job = await claim();
    await expect(
      f.deps.inspect({ ...job, userId: owners[1].userId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.gmail.getThread).not.toHaveBeenCalled();
  });

  it('sincroniza, encola y clasifica automáticamente sin crear borradores', async () => {
    await enable();
    const messages = ['m1', 'm2', 'm3'].map((id) => ({
      ...classifierMessage({ to: owners[0].email, text: id }),
      id,
      threadId: `t_${id}`,
    }));
    const text = {
      generate: vi.fn(async (input: { input: string }) => {
        const body = JSON.parse(input.input).text;
        return {
          text: JSON.stringify({
            decision:
              body === 'm1'
                ? 'REPLY_REQUIRED'
                : body === 'm2'
                  ? 'NO_REPLY'
                  : 'UNCERTAIN',
            intent:
              body === 'm1'
                ? 'REQUEST_INFORMATION'
                : body === 'm2'
                  ? 'NOTIFICATION'
                  : 'UNKNOWN',
            reasons:
              body === 'm1'
                ? ['EXPLICIT_QUESTION']
                : body === 'm2'
                  ? ['INFORMATION_ONLY']
                  : ['INSUFFICIENT_CONTEXT'],
            riskFlags: [],
            needsAttachment: false,
            confidence: 'HIGH',
          }),
          inputTokens: 12,
          outputTokens: 4,
        };
      }),
    };
    const gmail = {
      get: vi.fn(),
      async getThread(id: string) {
        return {
          id,
          messages: messages.filter((message) => message.threadId === id),
        };
      },
      async getMessage(id: string, options?: { format?: string }) {
        const full = messages.find((item) => item.id === id)!;
        return options?.format === 'metadata' ? classifierMetadata(full) : full;
      },
    };
    const jobs = {
      store,
      inspect: (job: EmailJob) =>
        checkAccountEmailIntervention({ client: service, job, gmail }),
      classifierFor: (work: (typeof owners)[number]) =>
        createAccountEmailClassifier({ client: service, work, gmail, text }),
      report: vi.fn(),
    };
    const syncStore = createGmailSyncStore(service);
    const sync = {
      store: {
        ...syncStore,
        async recordPage(...args: Parameters<typeof syncStore.recordPage>) {
          const recorded = await syncStore.recordPage(...args);
          await makeJobsDue();
          return recorded;
        },
      },
      gmailFor: async () => ({
        listMessages: async () => ({
          messages: messages.map(({ id, threadId }) => ({ id, threadId })),
        }),
      }),
      report: vi.fn(),
    };
    const cycle = await runMailWorkerCycle(
      sync,
      readSyncConfig({}),
      jobs,
      config,
    );
    expect(
      cycle,
      JSON.stringify({
        sync: sync.report.mock.calls,
        jobs: jobs.report.mock.calls,
      }),
    ).toEqual({ failed: false });
    const rows = await service
      .from('email_jobs')
      .select(
        'target_message_id,status,classification_finished_at,generation_started_at,classification',
      )
      .eq('user_id', owners[0].userId)
      .order('target_message_id');
    expect(rows.error).toBeNull();
    expect(rows.data!.map((row) => row.status)).toEqual([
      'GENERATING',
      'SKIPPED',
      'REVIEW_REQUIRED',
    ]);
    expect(
      rows.data!.every(
        (row) =>
          row.classification_finished_at !== null &&
          row.generation_started_at === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(rows.data)).not.toContain('explanation');
    expect(text.generate).toHaveBeenCalledTimes(3);
    await runMailWorkerCycle(sync, readSyncConfig({}), jobs, config);
    expect(text.generate).toHaveBeenCalledTimes(3);
  });
  it('el registro de mensajes crea un solo trabajo y dos workers no lo reclaman a la vez', async () => {
    await enqueue();
    await enqueue();
    await enable();
    const result = await Promise.all([
      store.claim(300, false),
      store.claim(300, false),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    const rows = await service
      .from('email_jobs')
      .select('id')
      .eq('user_id', owners[0].userId);
    expect(rows.data).toHaveLength(1);
  });
  it('la recuperación cambia el token y rechaza al worker obsoleto', async () => {
    await enqueue();
    await enable();
    const old = await claim();
    await expire(old);
    expect(await store.recover(20)).toBe(1);
    const resumed = await claim();
    expect(resumed.id).toBe(old.id);
    expect(resumed.leaseId).not.toBe(old.leaseId);
    expect(await store.renew(old, 300)).toBe(false);
    await expect(
      store.advance(old, { status: 'FAILED', reasonCode: 'UNAVAILABLE' }),
    ).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect((await saved(old.id)).attempt_count).toBe(2);
  });
  it('reiniciar después de clasificar permite continuar en generación sin volver a llamar al clasificador', async () => {
    await enqueue();
    await enable();
    const job = await claim();
    await store.advance(job, {
      status: 'GENERATING',
      classification: jobClassification(positive),
    });
    const nextStore = createEmailJobStore(service);
    const classify = vi.fn(async () => positive);
    const generate = vi.fn(async () => ({
      status: 'DRAFT_CREATED' as const,
      draftId: 'draft_completed',
    }));
    const deps = {
      store: nextStore,
      inspect: async () => ({ status: 'CONTINUE' as const }),
      classifierFor: async () => ({ classify }),
      generate,
      report: vi.fn(),
    };
    expect(await runEmailJobCycle(deps, config)).toMatchObject({
      draftsCreated: 1,
      classified: 0,
    });
    expect(classify).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledOnce();
    const completed = await saved(job.id);
    expect(completed.status).toBe('DRAFT_CREATED');
    expect(completed.draft_id).toBe('draft_completed');
    await runEmailJobCycle(deps, config);
    expect(generate).toHaveBeenCalledOnce();
    const events = await service
      .from('email_job_events')
      .select('to_status')
      .eq('email_job_id', job.id)
      .order('id');
    expect(events.data!.map((event) => event.to_status)).toEqual([
      'PENDING',
      'CLASSIFYING',
      'GENERATING',
      'DRAFT_CREATED',
    ]);
  });
  it('una generación caída exige revisión y conserva la clasificación completada', async () => {
    await enqueue();
    await enable();
    const first = await claim();
    await store.advance(first, {
      status: 'GENERATING',
      classification: jobClassification(positive),
    });
    const generating = await claim(true);
    await expire(generating);
    const classify = vi.fn(async () => positive);
    const generate = vi.fn(async () => ({
      status: 'DRAFT_CREATED' as const,
      draftId: 'must_not_repeat',
    }));
    expect(
      await runEmailJobCycle(
        {
          store,
          inspect: async () => ({ status: 'CONTINUE' as const }),
          classifierFor: async () => ({ classify }),
          generate,
          report: vi.fn(),
        },
        config,
      ),
    ).toMatchObject({ recovered: 1, claimed: 0 });
    const row = await saved(first.id);
    expect(row.status).toBe('REVIEW_REQUIRED');
    expect(row.reason_code).toBe('GENERATION_INTERRUPTED');
    expect(row.classification).not.toBeNull();
    expect(row.generation_finished_at).not.toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });
  it('permite reintentar un fallo de clasificación, respetando el propietario y las acciones completadas', async () => {
    await enqueue();
    await enable();
    const job = await claim();
    await store.advance(job, {
      status: 'FAILED',
      reasonCode: 'MODEL_UNAVAILABLE',
    });
    expect(await store.retry(owners[1], job.id)).toBe(false);
    expect(await store.retry(owners[0], job.id)).toBe(true);
    await makeJobsDue();
    const retry = await claim();
    await store.advance(retry, {
      status: 'SKIPPED',
      classification: jobClassification({
        ...positive,
        decision: 'NO_REPLY',
        reasons: ['INFORMATION_ONLY'],
      }),
    });
    expect(await store.retry(owners[0], job.id)).toBe(false);
  });
  it('pausa y desactivación impiden reclamar o confirmar una etapa activa', async () => {
    await enqueue();
    expect(await store.claim(300, false)).toBeNull();
    await enable();
    const job = await claim();
    expect(
      (
        await service
          .from('user_settings')
          .update({ automation_enabled: false })
          .eq('user_id', job.userId)
      ).error,
    ).toBeNull();
    expect(await store.renew(job, 300)).toBe(false);
    await expect(
      store.advance(job, {
        status: 'GENERATING',
        classification: jobClassification(positive),
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await store.advance(job, {
      status: 'PENDING',
      reasonCode: 'WORKER_STOPPED',
    });
    expect((await saved(job.id)).status).toBe('PENDING');
  });
  it('valida usuario y cuenta en operaciones privilegiadas y mantiene IDs iguales separados por buzón', async () => {
    await enqueue('m1', 0);
    await enqueue('m1', 1);
    await enable(0);
    await enable(1);
    const claims = await Promise.all([
      store.claim(300, false),
      store.claim(300, false),
    ]);
    expect(claims.every(Boolean)).toBe(true);
    expect(new Set(claims.map((job) => job!.gmailAccountId)).size).toBe(2);
    const job = claims[0]!;
    const other = owners.find((owner) => owner.userId !== job.userId)!;
    expect(await store.renew({ ...job, userId: other.userId }, 300)).toBe(
      false,
    );
    await expect(
      store.advance(
        { ...job, userId: other.userId },
        { status: 'FAILED', reasonCode: 'UNAVAILABLE' },
      ),
    ).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });
  it('RLS permite leer trabajos propios sin revelar leases ni modificar estados', async () => {
    await enqueue('m1', 0);
    await enqueue('m1', 1);
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
            password: 'Mail031-Synthetic-Password!',
          })
        ).error,
      ).toBeNull();
      const rows = await browser.from('email_jobs').select('id,user_id,status');
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(1);
      expect(rows.data![0].user_id).toBe(owners[0].userId);
      expect(
        (await browser.from('email_jobs').select('lease_id')).error?.code,
      ).toBe('42501');
      expect(
        (
          await browser
            .from('email_jobs')
            .update({ status: 'DRAFT_CREATED' })
            .eq('user_id', owners[0].userId)
        ).error?.code,
      ).toBe('42501');
      const events = await browser.from('email_job_events').select('user_id');
      expect(events.error).toBeNull();
      expect(events.data).toHaveLength(1);
      expect(events.data![0].user_id).toBe(owners[0].userId);
    } finally {
      await browser.auth.signOut({ scope: 'local' });
    }
  });
});
