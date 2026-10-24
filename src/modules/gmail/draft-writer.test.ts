import { describe, expect, it, vi } from 'vitest';
import type { GmailThread } from '@/providers/contracts';
import { createGmailClient } from '@/providers/gmail';
import {
  createProviderRequestExecutor,
  type ProviderRequestGate,
} from '@/providers/request-policy';
import { readRequestPolicyConfig } from '@/worker/request-config';
import { draftFixture } from '../../../tests/fixtures/drafts';
import { createEmailFixtures } from '../../../tests/fixtures/emails';
import { readyResponse } from '../../../tests/fixtures/responses';
import { promptInjectionCorpus } from '../../../tests/fixtures/prompt-injections';
import {
  selectPendingEmail,
  type PreparedReplyContext,
} from './manual-selection';
import { createDraftWriter, draftRevalidationMaxAgeMs } from './draft-writer';
import { DraftPreconditionError } from './draft-contracts';

function intervened(
  thread: GmailThread,
  change: 'manualDraft' | 'answered' | 'newIncoming',
): GmailThread {
  const original = thread.messages[0];
  const outgoing =
    change === 'newIncoming'
      ? original
      : createEmailFixtures()[change].messages.at(-1)!;
  const messageId = original.payload!.headers!.find(
    (header) => header.name === 'Message-ID',
  )!.value;
  return {
    ...thread,
    messages: [
      ...thread.messages,
      {
        ...outgoing,
        id: 'new-message34',
        threadId: thread.id,
        internalDate: String(Number(original.internalDate) + 1000),
        payload: {
          ...outgoing.payload,
          headers: outgoing.payload!.headers!.map((header) =>
            ['In-Reply-To', 'References'].includes(header.name)
              ? { ...header, value: messageId }
              : header,
          ),
        },
      },
    ],
  };
}

async function fixture() {
  const f = draftFixture();
  let thread: GmailThread = f.thread;
  let elapsed = 0;
  let held = 0;
  let savedRaw = '';
  const posts = vi.fn();
  const gate = {
    acquire: vi.fn<ProviderRequestGate['acquire']>(async () => {
      // A nested revalidation while holding the POST permit would fail here.
      expect(held).toBe(0);
      held++;
      return { leaseId: crypto.randomUUID(), retryAfterMs: 0 };
    }),
    release: vi.fn<ProviderRequestGate['release']>(async () => {
      held--;
    }),
    cooldown: vi.fn<ProviderRequestGate['cooldown']>().mockResolvedValue(),
  };
  const pause = vi.fn(async (ms: number) => {
    elapsed += ms;
  });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST') {
      savedRaw = JSON.parse(String(init.body)).message.raw;
      posts();
      return Response.json({
        id: 'draft34',
        message: { id: 'message34', threadId: thread.id },
      });
    }
    if (String(url).includes('/threads/')) return Response.json(thread);
    return Response.json({
      id: 'message34',
      threadId: thread.id,
      labelIds: ['DRAFT'],
      raw: savedRaw,
    });
  });
  const token = vi.fn(async () => 'test-token');
  const execute = createProviderRequestExecutor({
    gate,
    config: readRequestPolicyConfig({ WORKER_ACCOUNT_MAX_CONCURRENT: '1' }),
    now: () => elapsed,
    pause,
  });
  const gmail = createGmailClient(token, 30000, fetcher, execute);
  let context!: PreparedReplyContext;
  await selectPendingEmail(f.gmail, f.selection, async (value) => {
    context = structuredClone(value);
  });
  const options = {
    selection: f.selection,
    context,
    model: f.model,
    response: {
      ...readyResponse(),
      modelCalls: 2,
      examplesUsed: 0,
      inputTokens: 100,
      outputTokens: 30,
    },
  };
  const writer = createDraftWriter({
    gmail,
    store: f.store,
    monotonicNow: () => elapsed,
  });
  return {
    ...f,
    gmail,
    writer,
    options,
    posts,
    fetcher,
    gate,
    token,
    pause,
    setThread: (value: GmailThread) => {
      thread = value;
    },
    advanceTime: (ms: number) => {
      elapsed += ms;
    },
  };
}

describe('MAIL-034 última validación antes del POST real', () => {
  it.each([3, 4, 6, 20])(
    'EPIC-07 creates one verified draft after %i provider attempts across the two phases',
    async (modelCalls) => {
      const f = await fixture();
      expect(
        await f.writer.create({
          ...f.options,
          response: { ...f.options.response, modelCalls },
        }),
      ).toMatchObject({ status: 'CREATED' });
      expect(f.posts).toHaveBeenCalledOnce();
    },
  );
  it.each([0, 1, 2.5, 21, NaN])(
    'EPIC-07 rejects invalid or incomplete model usage: %s',
    async (modelCalls) => {
      const f = await fixture();
      await expect(
        f.writer.create({
          ...f.options,
          response: { ...f.options.response, modelCalls },
        }),
      ).rejects.toMatchObject({ code: 'RESPONSE_NOT_READY' });
      expect(f.store.reserve).not.toHaveBeenCalled();
      expect(f.posts).not.toHaveBeenCalled();
    },
  );
  it.each(promptInjectionCorpus)(
    'MAIL-049 rejects a forged READY containing %s before reservation or Gmail access',
    async (_name, attack) => {
      const f = await fixture();
      await expect(
        f.writer.create({
          ...f.options,
          response: { ...f.options.response, bodyText: attack },
        }),
      ).rejects.toMatchObject({ code: 'RESPONSE_NOT_READY' });
      expect(f.store.reserve).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.posts).not.toHaveBeenCalled();
    },
  );
  it('MAIL-045 impide que una respuesta READY falsa confirme un pago', async () => {
    const f = await fixture();
    await expect(
      f.writer.create({
        ...f.options,
        response: {
          ...f.options.response,
          bodyText: 'Confirmo el pago realizado.',
        },
      }),
    ).rejects.toMatchObject({ code: 'RESPONSE_NOT_READY' });
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.posts).not.toHaveBeenCalled();
  });
  it('MAIL-043 lleva las referencias a persistencia y mantiene el contenido interno fuera del MIME', async () => {
    const f = await fixture();
    const sourcesUsed = [{ kind: 'THREAD_MESSAGE' as const, messageIndex: 0 }];
    await f.writer.create({
      ...f.options,
      response: { ...f.options.response, sourcesUsed },
    });
    expect(f.store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ sourcesUsed }),
    );
    const post = f.fetcher.mock.calls.find(
      ([, init]) => init?.method === 'POST',
    );
    const raw = JSON.parse(String(post![1]!.body)).message.raw;
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).not.toMatch(
      /sourcesUsed|THREAD_MESSAGE|HUMAN_REVIEW_REQUIRED/,
    );
  });
  it('MAIL-041 una propuesta PARTIAL nunca consume una reserva ni escribe en Gmail', async () => {
    const f = await fixture();
    f.options.response.status = 'PARTIAL';
    f.options.response.missingInformation = ['Tarifa pendiente.'];
    await expect(f.writer.create(f.options)).rejects.toMatchObject({
      code: 'RESPONSE_NOT_READY',
    });
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.posts).not.toHaveBeenCalled();
  });
  it('MAIL-035: un límite diario agotado cancela antes de HTTP con una causa explícita', async () => {
    const f = await fixture();
    f.store.beginWrite.mockRejectedValue(
      new DraftPreconditionError('DAILY_DRAFT_LIMIT'),
    );
    expect(await f.writer.create(f.options)).toMatchObject({
      status: 'CANCELLED',
      reason: 'DAILY_DRAFT_LIMIT',
    });
    expect(f.posts).not.toHaveBeenCalled();
    expect(f.store.stop).toHaveBeenCalledWith(
      expect.any(String),
      'CANCELLED',
      'DAILY_DRAFT_LIMIT',
    );
  });
  it('escribe una sola vez con concurrencia de una petición y sin serializar callbacks', async () => {
    const f = await fixture();
    expect(await f.writer.create(f.options)).toMatchObject({
      status: 'CREATED',
    });
    expect(f.posts).toHaveBeenCalledOnce();
    expect(f.store.beginWrite).toHaveBeenCalledOnce();
    expect(f.gate.acquire).toHaveBeenCalledTimes(3);
    const body = JSON.parse(
      String(
        f.fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]!
          .body,
      ),
    );
    expect(Object.keys(body)).toEqual(['message']);
    expect(Object.keys(body.message)).toEqual(['raw', 'threadId']);
  });
  it.each(['manualDraft', 'answered', 'newIncoming'] as const)(
    'vuelve a leer tras esperar cuota y cancela ante %s sin POST',
    async (change) => {
      const f = await fixture();
      const acquire = f.gate.acquire.getMockImplementation()!;
      let count = 0;
      f.gate.acquire.mockImplementation(async (...args) =>
        ++count === 2
          ? { leaseId: null, retryAfterMs: 1000 }
          : acquire(...args),
      );
      f.pause.mockImplementation(async (ms) => {
        f.advanceTime(ms);
        f.setThread(intervened(f.thread, change));
      });
      expect(await f.writer.create(f.options)).toMatchObject({
        status: 'CANCELLED',
        reason: 'THREAD_CHANGED',
      });
      expect(f.pause).toHaveBeenCalledOnce();
      expect(
        f.fetcher.mock.calls.filter(([url]) =>
          String(url).includes('/threads/'),
        ),
      ).toHaveLength(2);
      expect(f.posts).not.toHaveBeenCalled();
      expect(f.store.beginWrite).not.toHaveBeenCalled();
      expect(f.rows[0].status).toBe('CANCELLED');
    },
  );
  it('una espera sin cambios vuelve a validar y crea exactamente un borrador', async () => {
    const f = await fixture();
    const acquire = f.gate.acquire.getMockImplementation()!;
    let count = 0;
    f.gate.acquire.mockImplementation(async (...args) =>
      ++count === 2 ? { leaseId: null, retryAfterMs: 6000 } : acquire(...args),
    );
    expect(await f.writer.create(f.options)).toMatchObject({
      status: 'CREATED',
    });
    expect(f.posts).toHaveBeenCalledOnce();
    expect(f.store.beginWrite).toHaveBeenCalledOnce();
    expect(
      f.fetcher.mock.calls.filter(([url]) => String(url).includes('/threads/')),
    ).toHaveLength(2);
  });
  it('lee el estado posterior a la obtención de las credenciales', async () => {
    const f = await fixture();
    f.token.mockImplementationOnce(async () => {
      f.setThread(intervened(f.thread, 'manualDraft'));
      return 'test-token';
    });
    expect(await f.writer.create(f.options)).toMatchObject({
      status: 'CANCELLED',
      reason: 'THREAD_CHANGED',
    });
    expect(f.posts).not.toHaveBeenCalled();
  });
  it.each(['permit', 'database', 'preferences'])(
    'rechaza una lectura que envejece esperando %s',
    async (delay) => {
      const f = await fixture();
      if (delay === 'permit') {
        const acquire = f.gate.acquire.getMockImplementation()!;
        let count = 0;
        f.gate.acquire.mockImplementation(async (...args) => {
          if (++count === 2) f.advanceTime(draftRevalidationMaxAgeMs + 1);
          return acquire(...args);
        });
      } else if (delay === 'database') {
        const begin = f.store.beginWrite.getMockImplementation()!;
        f.store.beginWrite.mockImplementation(async (...args) => {
          const result = await begin(...args);
          f.advanceTime(draftRevalidationMaxAgeMs + 1);
          return result;
        });
      } else {
        await selectPendingEmail(
          { getThread: async () => f.thread },
          {
            ...f.selection,
            resolvePreferences: async () => ({
              preferences: [],
              revisions: [],
            }),
          },
          async (context) => {
            f.options.context = structuredClone(context);
          },
        );
        Object.assign(f.options.selection, {
          resolvePreferences: async () => {
            f.advanceTime(draftRevalidationMaxAgeMs + 1);
            return { preferences: [], revisions: [] };
          },
        });
      }
      expect(await f.writer.create(f.options)).toMatchObject({
        status: 'CANCELLED',
        reason: 'PREWRITE_FAILED',
      });
      expect(f.posts).not.toHaveBeenCalled();
      expect(f.rows[0].status).toBe('CANCELLED');
    },
  );
  it('no escribe cuando otro proceso consumió el permiso persistente', async () => {
    const f = await fixture();
    f.store.beginWrite.mockResolvedValue(false);
    expect(await f.writer.create(f.options)).toMatchObject({
      status: 'CANCELLED',
      reason: 'PREWRITE_FAILED',
    });
    expect(f.posts).not.toHaveBeenCalled();
  });
  it('un error de Google después del permiso queda incierto y no se reintenta', async () => {
    const f = await fixture();
    const fetcher = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (...args) =>
      args[1]?.method === 'POST'
        ? Response.json({}, { status: 503 })
        : fetcher(...args),
    );
    expect(await f.writer.create(f.options)).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
    });
    expect(
      f.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
    expect(f.rows[0].status).toBe('UNCERTAIN');
    expect(await f.writer.create(f.options)).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
    });
    expect(f.store.beginWrite).toHaveBeenCalledOnce();
  });
});
