import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CookieOptions } from '@supabase/ssr';
import type { Database } from '@/db/database.types';
import { DataAccessError } from '@/db/errors';
import { openUserDataAccess } from '@/db/user-data';
import { createAuthClient } from '@/modules/auth/client';
import { openWorkerDataAccess } from '@/worker/data-access';
import { createWorkerRuntime } from '@/worker/runtime';
import { readServerConfig } from '@/config/env';
import { createProviderMocks } from './mocks/providers';

const url = process.env.AUTO_EMAIL_TEST_URL ?? '';
const publishableKey = process.env.AUTO_EMAIL_TEST_PUBLISHABLE_KEY ?? '';
const secretKey = process.env.AUTO_EMAIL_TEST_SECRET_KEY ?? '';
const appOrigin = process.env.AUTO_EMAIL_TEST_APP_URL ?? '';
const password = `Test-${crypto.randomUUID()}`;
const createdUsers: string[] = [];
const clients: ReturnType<typeof createAuthClient>[] = [];
type Fixture = { id: string; accountId: string; runId: string; email: string };
const owners: Fixture[] = [];
const jars: Map<string, string>[] = [];

function localUrl(value: string) {
  const parsed = new URL(value);
  if (
    !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    parsed.port !== '55321'
  )
    throw new Error('Solo se permite la base local auto-email.');
}

describe('MAIL-008 con Supabase real y dos usuarios', () => {
  let service: ReturnType<typeof createClient<Database>>;

  beforeAll(async () => {
    localUrl(url);
    service = createClient<Database>(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (let i = 0; i < 2; i++) {
      const email = `mail008-${crypto.randomUUID()}@example.invalid`;
      const result = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(result.error).toBeNull();
      const id = result.data.user!.id;
      createdUsers.push(id);
      const account = await service
        .from('gmail_accounts')
        .insert({ user_id: id, email, encrypted_refresh_token: '\\x74657374' })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      const run = await service
        .from('processing_runs')
        .insert({ user_id: id, gmail_account_id: account.data!.id })
        .select('id')
        .single();
      expect(run.error).toBeNull();
      owners.push({
        id,
        email,
        accountId: account.data!.id,
        runId: run.data!.id,
      });
      const jar = new Map<string, string>();
      jars.push(jar);
      const client = createAuthClient(
        {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookies) => {
            for (const { name, value, options } of cookies) {
              if (!value || (options as CookieOptions).maxAge === 0)
                jar.delete(name);
              else jar.set(name, value);
            }
          },
        },
        { appOrigin, supabaseUrl: url, publishableKey, secureCookies: false },
      );
      clients.push(client);
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
    }
  });

  afterAll(async () => {
    for (const client of clients) await client.auth.signOut({ scope: 'local' });
    for (const id of createdUsers)
      expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
  });

  it.each([0, 1])(
    'el usuario %i solo recibe su cuenta, ajustes y ejecuciones',
    async (index) => {
      const own = owners[index];
      const other = owners[1 - index];
      const data = await openUserDataAccess(clients[index]);
      expect(data.user.id).toBe(own.id);
      expect((await data.settings.get()).user_id).toBe(own.id);
      expect((await data.gmailAccounts.get())?.id).toBe(own.accountId);
      expect(await data.gmailAccounts.findById(other.accountId)).toBeNull();
      expect((await data.processingRuns.list()).map((run) => run.id)).toEqual([
        own.runId,
      ]);
      expect(await data.processingRuns.findById(other.runId)).toBeNull();
      expect(data.processingRuns).not.toHaveProperty('start');
      expect(await data.gmailAccounts.get()).not.toHaveProperty(
        'encrypted_refresh_token',
      );
    },
  );

  it('el servicio omite RLS, pero los repositorios del worker siguen aislando ambos usuarios', async () => {
    const worker = await openWorkerDataAccess(service, {
      userId: owners[0].id,
      gmailAccountId: owners[0].accountId,
    });
    expect((await worker.getSettings()).user_id).toBe(owners[0].id);
    expect(await worker.processingRuns.findById(owners[1].runId)).toBeNull();
    await expect(
      worker.processingRuns.finish(owners[1].runId, {
        status: 'COMPLETED',
        messagesDetected: 1,
        messagesProcessed: 1,
        draftsCreated: 1,
        errorCount: 0,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const untouched = await service
      .from('processing_runs')
      .select('status')
      .eq('id', owners[1].runId)
      .single();
    expect(untouched.data?.status).toBe('RUNNING');
  });

  it('rechaza un trabajo que empareja un usuario con la cuenta de otro', async () => {
    await expect(
      openWorkerDataAccess(service, {
        userId: owners[0].id,
        gmailAccountId: owners[1].accountId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('el runtime del worker compone el cliente privilegiado y los proveedores desde la configuración', async () => {
    const { providers: mocks } = createProviderMocks();
    const config = readServerConfig({
      APP_ENV: 'test',
      PROVIDER_MODE: 'mock',
      APP_URL: appOrigin,
      SUPABASE_URL: url,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_SECRET_KEY: secretKey,
      PROVIDER_TIMEOUT_MS: '30000',
    });
    const runtime = createWorkerRuntime(config, mocks);
    const data = await runtime.dataFor({
      userId: owners[0].id,
      gmailAccountId: owners[0].accountId,
    });
    expect((await data.getSettings()).user_id).toBe(owners[0].id);
    expect(runtime.providers).toBe(mocks);
    await expect(
      runtime.dataFor({
        userId: owners[0].id,
        gmailAccountId: owners[1].accountId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('incluye siempre el propietario en las consultas y escrituras privilegiadas', async () => {
    const requests: {
      url: URL;
      method: string;
      body: Record<string, unknown> | null;
    }[] = [];
    const auditedService = createClient<Database>(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          requests.push({
            url: new URL(
              typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url,
            ),
            method: init?.method ?? 'GET',
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
          });
          return fetch(input, init);
        },
      },
    });
    const worker = await openWorkerDataAccess(auditedService, {
      userId: owners[0].id,
      gmailAccountId: owners[0].accountId,
    });
    await worker.getSettings();
    await worker.getAccount();
    const run = await worker.processingRuns.start('MANUAL');
    await worker.processingRuns.findById(run.id);
    await worker.processingRuns.finish(run.id, {
      status: 'COMPLETED',
      messagesDetected: 0,
      messagesProcessed: 0,
      draftsCreated: 0,
      errorCount: 0,
    });
    expect(requests.length).toBeGreaterThan(5);
    for (const request of requests) {
      expect(request.url.pathname).toMatch(/^\/rest\/v1\//);
      if (request.method === 'POST') {
        expect(request.body?.user_id).toBe(owners[0].id);
        expect(request.body?.gmail_account_id).toBe(owners[0].accountId);
      } else {
        const key = request.url.pathname.endsWith('/users') ? 'id' : 'user_id';
        expect(request.url.searchParams.get(key)).toBe(`eq.${owners[0].id}`);
        if (request.method === 'PATCH') {
          expect(request.url.searchParams.get('gmail_account_id')).toBe(
            `eq.${owners[0].accountId}`,
          );
          expect(request.url.searchParams.get('id')).toBe(`eq.${run.id}`);
        }
      }
      expect(request.url.searchParams.get('select')).not.toContain('*');
      expect(request.url.searchParams.get('select')).not.toContain(
        'encrypted_refresh_token',
      );
    }
  });

  it('el worker crea y finaliza ejecuciones únicamente para la cuenta asignada', async () => {
    const work = { userId: owners[0].id, gmailAccountId: owners[0].accountId };
    const worker = await openWorkerDataAccess(service, work);
    work.userId = owners[1].id;
    work.gmailAccountId = owners[1].accountId;
    const run = await worker.processingRuns.start('SCHEDULED');
    expect(run.user_id).toBe(owners[0].id);
    expect(run.gmail_account_id).toBe(owners[0].accountId);
    const outcome = {
      status: 'COMPLETED' as const,
      messagesDetected: 2,
      messagesProcessed: 1,
      draftsCreated: 1,
      errorCount: 0,
      user_id: owners[1].id,
      gmail_account_id: owners[1].accountId,
    };
    const completed = await worker.processingRuns.finish(run.id, outcome);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.user_id).toBe(owners[0].id);
    expect(completed.gmail_account_id).toBe(owners[0].accountId);
    await expect(
      worker.processingRuns.finish(run.id, outcome),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rechaza propietarios, IDs, límites y resultados inválidos', async () => {
    await expect(
      openWorkerDataAccess(service, {
        userId: '',
        gmailAccountId: owners[0].accountId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const data = await openUserDataAccess(clients[0]);
    await expect(
      data.gmailAccounts.findById('not-a-uuid'),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(data.processingRuns.list(101)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    const worker = await openWorkerDataAccess(service, {
      userId: owners[0].id,
      gmailAccountId: owners[0].accountId,
    });
    await expect(
      worker.processingRuns.finish(owners[0].runId, {
        status: 'FAILED',
        errorCode: 'private text',
        messagesDetected: 0,
        messagesProcessed: 0,
        draftsCreated: 0,
        errorCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('RLS protege las lecturas directas y las columnas de credenciales siguen denegadas', async () => {
    expect(
      (
        await clients[0]
          .from('gmail_accounts')
          .select('id')
          .eq('id', owners[1].accountId)
      ).data,
    ).toEqual([]);
    expect(
      (
        await clients[0]
          .from('processing_runs')
          .select('id')
          .eq('id', owners[1].runId)
      ).data,
    ).toEqual([]);
    expect(
      (
        await clients[0]
          .from('gmail_accounts')
          .select('encrypted_refresh_token')
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await clients[0]
          .from('user_settings')
          .update({ automation_enabled: true })
          .eq('user_id', owners[1].id)
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await clients[0]
          .from('processing_runs')
          .delete()
          .eq('id', owners[1].runId)
      ).error?.code,
    ).toBe('42501');
  });

  const http = (path: string, owner?: number) =>
    fetch(appOrigin + path, {
      redirect: 'manual',
      headers:
        owner === undefined
          ? {}
          : {
              Cookie: [...jars[owner]]
                .map(([name, value]) => `${name}=${value}`)
                .join('; '),
            },
    });

  it('todos los endpoints rechazan peticiones sin sesión, incluso con IDs ajenos', async () => {
    for (const path of [
      '/api/gmail-account',
      '/api/processing-runs',
      `/api/processing-runs/${owners[0].runId}`,
    ]) {
      const response = await http(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });

  it.each([0, 1])(
    'los endpoints del usuario %i rechazan IDs ajenos sin filtrar datos',
    async (index) => {
      const other = owners[1 - index];
      const account = await (
        await http('/api/gmail-account?user_id=' + other.id, index)
      ).json();
      expect(account.id).toBe(owners[index].accountId);
      expect(account).not.toHaveProperty('encrypted_refresh_token');
      const list = await (
        await http('/api/processing-runs?user_id=' + other.id, index)
      ).json();
      expect(
        list.every(
          (run: { user_id: string }) => run.user_id === owners[index].id,
        ),
      ).toBe(true);
      const foreign = await http(`/api/processing-runs/${other.runId}`, index);
      const absent = await http(
        '/api/processing-runs/20000000-0000-4000-8000-000000000099',
        index,
      );
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toEqual(await absent.json());
      expect(
        (await http(`/api/processing-runs/${owners[index].runId}`, index))
          .status,
      ).toBe(200);
    },
  );

  it('una cuenta deshabilitada pierde acceso en backend, RLS y un worker ya abierto', async () => {
    const worker = await openWorkerDataAccess(service, {
      userId: owners[1].id,
      gmailAccountId: owners[1].accountId,
    });
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DISABLED' })
          .eq('id', owners[1].id)
      ).error,
    ).toBeNull();
    try {
      await expect(openUserDataAccess(clients[1])).rejects.toBeInstanceOf(
        DataAccessError,
      );
      await expect(worker.getSettings()).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        worker.processingRuns.start('SCHEDULED'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(
        (await clients[1].from('gmail_accounts').select('id')).data,
      ).toEqual([]);
      expect((await http('/api/gmail-account', 1)).status).toBe(403);
    } finally {
      expect(
        (
          await service
            .from('users')
            .update({ status: 'ACTIVE' })
            .eq('id', owners[1].id)
        ).error,
      ).toBeNull();
    }
  });
});
