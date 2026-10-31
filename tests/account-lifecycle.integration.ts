import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import {
  createAccountLifecycleRepository,
  createAccountDeletionStore,
  getDeletionReceipt,
} from '@/db/account-deletion';
import { runAccountDeletions } from '@/modules/account/lifecycle';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createWritingProfileRepository } from '@/db/writing-profiles';
import { createStylePreferenceRepository } from '@/db/style-preferences';
import { createStyleRelationshipRepository } from '@/db/style-relationships';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { createGmailConnection } from '@/modules/gmail/credentials';
import { encryptGmailRefreshToken } from '@/modules/gmail/tokens';
import { withMessageQueries } from '@/providers/gmail-messages';
import { SecretValue } from '@/config/env';
import { gmailScopes } from '@/config/google';
import { writingProfileFixture } from './fixtures/writing-profile';
import { seedActivityJob } from './fixtures/activity-store';
import { assertExecutionAllowed } from '@/db/execution-controls';
const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const key = new SecretValue(Buffer.alloc(32, 55).toString('base64'));
type Owner = {
  id: string;
  accountId: string;
  email: string;
  password: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
};
const owners: Owner[] = [];
const cookies = (owner: Owner) =>
  [...owner.jar].map(([name, value]) => `${name}=${value}`).join('; ');
async function createOwner() {
  const email = `mail055-${crypto.randomUUID()}@example.invalid`,
    password = `Test-${crypto.randomUUID()}`;
  const result = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(result.error).toBeNull();
  const jar = new Map<string, string>();
  const client = createAuthClient(
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
  const owner = {
    id: result.data.user!.id,
    accountId: '',
    email,
    password,
    jar,
    client,
  };
  owners.push(owner);
  expect(
    (await client.auth.signInWithPassword({ email, password })).error,
  ).toBeNull();
  const account = await service
    .from('gmail_accounts')
    .insert({
      user_id: owner.id,
      email,
      status: 'CONNECTED',
      encrypted_refresh_token: encryptGmailRefreshToken(
        new SecretValue('mail055-test-refresh'),
        key,
        owner.id,
        email,
      ),
      scope_set: [...gmailScopes],
    })
    .select('id')
    .single();
  expect(account.error).toBeNull();
  owner.accountId = account.data!.id;
  return owner;
}
const post = (
  owner: Owner,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(`${origin}/api/account/lifecycle`, {
    method: 'POST',
    headers: {
      origin,
      cookie: cookies(owner),
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
async function assertQuery<T extends { error: unknown }>(
  value: PromiseLike<T>,
) {
  const result = await value;
  expect(result.error).toBeNull();
  return result;
}
describe('MAIL-055 cuenta, desconexión, borrado y reintentos con servicios locales', () => {
  beforeAll(() => {
    if (new URL(url).origin !== 'http://127.0.0.1:55321')
      throw new Error('Solo Supabase local');
  });
  afterAll(async () => {
    for (const owner of owners) {
      const found = await service.auth.admin.getUserById(owner.id);
      if (!found.data.user) continue;
      const files = await assertQuery(
        service.storage.from('knowledge-documents').list(owner.id),
      );
      if (files.data?.length)
        await assertQuery(
          service.storage
            .from('knowledge-documents')
            .remove(files.data.map((file) => `${owner.id}/${file.name}`)),
        );
      await assertQuery(
        service.from('source_rules').delete().eq('user_id', owner.id),
      );
      await assertQuery(
        service.from('source_documents').delete().eq('user_id', owner.id),
      );
      await owner.client.auth.signOut({ scope: 'local' });
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });
  it('desconecta y cancela trabajo pendiente o en curso sin volver a consultar Gmail', async () => {
    const owner = await createOwner(),
      other = await createOwner();
    const pending = await seedActivityJob(service, owner),
      classifying = await seedActivityJob(service, owner, {
        status: 'CLASSIFYING',
      }),
      generating = await seedActivityJob(service, owner, {
        status: 'GENERATING',
      }),
      foreign = await seedActivityJob(service, other);
    await assertQuery(
      service
        .from('user_settings')
        .update({ automation_enabled: true })
        .eq('user_id', owner.id),
    );
    const get = vi.fn().mockResolvedValue({}),
      revokeToken = vi.fn().mockResolvedValue(undefined);
    const connection = createGmailConnection({
      store: createGmailCredentialRepository(
        service,
        owner.id,
        owner.accountId,
      ),
      providers: {
        googleAuthorization: {
          revokeToken,
          refreshAccessToken: vi.fn(),
          getAuthorizationUrl: vi.fn(),
          exchangeCode: vi.fn(),
        },
        gmail: (token) =>
          withMessageQueries({
            get: async () => {
              await token();
              return get();
            },
            createDraft: vi.fn(),
          }),
      },
      encryptionKey: key,
      timeoutMs: 1000,
    });
    expect(await connection.disconnect()).toEqual({ revoked: true });
    expect(revokeToken).toHaveBeenCalledOnce();
    const rows = await assertQuery(
      service
        .from('email_jobs')
        .select('id,status,reason_code,lease_id')
        .in('id', [pending.id, classifying.id, generating.id, foreign.id]),
    );
    expect(rows.data).toEqual(
      expect.arrayContaining([
        {
          id: pending.id,
          status: 'SKIPPED',
          reason_code: 'ACCOUNT_DISCONNECTED',
          lease_id: null,
        },
        {
          id: classifying.id,
          status: 'SKIPPED',
          reason_code: 'ACCOUNT_DISCONNECTED',
          lease_id: null,
        },
        {
          id: generating.id,
          status: 'REVIEW_REQUIRED',
          reason_code: 'ACCOUNT_DISCONNECTED',
          lease_id: null,
        },
        expect.objectContaining({ id: foreign.id, status: 'PENDING' }),
      ]),
    );
    await expect(connection.client.get('profile')).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    await expect(
      assertExecutionAllowed(service, {
        userId: owner.id,
        gmailAccountId: owner.accountId,
      }),
    ).rejects.toThrow('FORBIDDEN');
  });
  it('borra perfiles, preferencias y relaciones, conserva documentos y pausa el procesamiento', async () => {
    const owner = await createOwner();
    const repository = createWritingProfileRepository(
      service,
      owner.id,
      owner.accountId,
    );
    await repository.save({
      profile: writingProfileFixture(),
      model: 'test-model',
      sampleSize: 1,
      sourceMessageIds: ['mail055_sent'],
      inputTokens: 1,
      outputTokens: 1,
      warnings: [],
    });
    await createStylePreferenceRepository(
      service,
      owner.id,
      owner.accountId,
    ).set({
      scope: { kind: 'GENERAL', key: '' },
      preference: { key: 'length', value: 'short' },
    });
    await createStyleRelationshipRepository(
      service,
      owner.id,
      owner.accountId,
    ).set({ kind: 'DOMAIN', key: 'example.invalid', category: 'CLIENT' });
    const document = await createKnowledgeDocuments(service, owner.id).upload(
      new File(
        ['Documento que debe conservarse al borrar estilo.'],
        'mail055-keep.txt',
        { type: 'text/plain' },
      ),
    );
    const pending = await seedActivityJob(service, owner);
    expect(
      (
        await post(owner, {
          action: 'reset_style',
          confirmation: 'BORRAR ESTILO',
        })
      ).status,
    ).toBe(200);
    for (const table of [
      'style_profiles',
      'style_preferences',
      'style_relationships',
    ] as const)
      expect(
        (
          await assertQuery(
            service.from(table).select('user_id').eq('user_id', owner.id),
          )
        ).data,
      ).toEqual([]);
    expect(
      (await createKnowledgeDocuments(service, owner.id).list()).map(
        (row) => row.id,
      ),
    ).toContain(document.id);
    expect(
      (
        await assertQuery(
          service
            .from('gmail_accounts')
            .select('status')
            .eq('id', owner.accountId)
            .single(),
        )
      ).data?.status,
    ).toBe('PAUSED');
    expect(
      (
        await assertQuery(
          service
            .from('email_jobs')
            .select('reason_code')
            .eq('id', pending.id)
            .single(),
        )
      ).data?.reason_code,
    ).toBe('STYLE_DELETED');
    expect(
      (
        await createAccountLifecycleRepository(service, owner.id).get()
      ).events.some((row) => row.action === 'STYLE_DELETED'),
    ).toBe(true);
  });
  it('rechaza peticiones sin sesión, sin confirmación o con otro propietario', async () => {
    const owner = await createOwner();
    expect(
      (
        await fetch(`${origin}/api/account/lifecycle`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'reset_style',
            confirmation: 'BORRAR ESTILO',
          }),
        })
      ).status,
    ).toBe(401);
    for (const body of [
      { action: 'reset_style' },
      {
        action: 'reset_style',
        confirmation: 'BORRAR ESTILO',
        userId: owners[0].id,
      },
      {
        action: 'delete_account',
        confirmation: 'ELIMINAR MI CUENTA',
        email: owners[0].email,
      },
    ])
      expect((await post(owner, body)).status).toBe(400);
    expect(
      (
        await post(
          owner,
          { action: 'reset_style', confirmation: 'BORRAR ESTILO' },
          { origin: 'https://evil.invalid' },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await owner.client.rpc('delete_writing_identity', {
          p_user_id: owners[0].id,
        })
      ).error?.code,
    ).toBe('42501');
    expect(
      (
        await fetch(`${origin}/api/gmail/disconnect`, {
          method: 'POST',
          headers: {
            origin,
            cookie: cookies(owner),
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'confirmed=false',
          redirect: 'manual',
        })
      ).status,
    ).toBe(400);
  });
  it('reintenta después de un fallo de Storage y elimina reglas, objetos y Auth en orden', async () => {
    const owner = await createOwner(),
      other = await createOwner();
    const docs = createKnowledgeDocuments(service, owner.id),
      sources = createKnowledgeSources(service, owner.id);
    const document = await docs.upload(
      new File(['MAIL055_PRIVATE_DOCUMENT_BODY'], 'mail055-delete.txt', {
        type: 'text/plain',
      }),
    );
    const foreignDocument = await createKnowledgeDocuments(
      service,
      other.id,
    ).upload(
      new File(['OTHER_MAIL055_PRIVATE_BODY'], 'mail055-other.txt', {
        type: 'text/plain',
      }),
    );
    const source = await sources.mutate({
      action: 'save_source',
      title: 'Fuente MAIL-055',
      priority: 0,
      enabled: true,
    });
    await sources.mutate({
      action: 'assign_document',
      documentId: document.id,
      sourceId: source.id,
    });
    await sources.mutate({
      action: 'save_rule',
      title: 'Regla de prueba',
      intent: '*',
      terms: [],
      priority: 0,
      enabled: true,
      allowEmailHistory: false,
      primarySourceIds: [source.id],
      fallbackSourceIds: [],
      excludedSourceIds: [],
    });
    const receipt = randomBytes(32).toString('hex'),
      id = await createAccountLifecycleRepository(
        service,
        owner.id,
      ).requestDeletion(receipt);
    expect(
      (
        await fetch(`${origin}/api/account`, {
          headers: { cookie: cookies(owner) },
        })
      ).status,
    ).toBe(403);
    const revoke = vi.fn(async () => {}),
      store = createAccountDeletionStore(service, revoke),
      broken = {
        ...store,
        removeFiles: vi.fn(async () => {
          throw new Error('simulated failure');
        }),
      };
    expect(
      (await runAccountDeletions(broken, { requestId: id, limit: 1 })).failed,
    ).toBe(true);
    expect((await getDeletionReceipt(service, receipt)).status).toBe('RETRY');
    expect((await service.auth.admin.getUserById(owner.id)).data.user?.id).toBe(
      owner.id,
    );
    expect((await docs.list()).map((row) => row.id)).toContain(document.id);
    await assertQuery(
      service
        .from('account_deletion_requests')
        .update({ next_attempt_at: '2000-01-01T00:00:00Z' })
        .eq('id', id),
    );
    expect(
      await runAccountDeletions(store, { requestId: id, limit: 1 }),
    ).toEqual({ completed: 1, failed: false });
    expect(revoke).toHaveBeenCalledOnce();
    expect(
      (await service.auth.admin.getUserById(owner.id)).data.user,
    ).toBeNull();
    const status = await getDeletionReceipt(service, receipt);
    expect(status.status).toBe('COMPLETED');
    expect(JSON.stringify(status)).not.toMatch(
      /mail055-|@example|PRIVATE|receipt_hash|user_id/,
    );
    expect(
      (
        await assertQuery(
          service
            .from('account_deletion_requests')
            .select('user_id')
            .eq('id', id)
            .single(),
        )
      ).data?.user_id,
    ).toBeNull();
    expect(
      (
        await assertQuery(
          service.storage.from('knowledge-documents').list(owner.id),
        )
      ).data,
    ).toEqual([]);
    expect(
      (await createKnowledgeDocuments(service, other.id).list()).map(
        (row) => row.id,
      ),
    ).toContain(foreignDocument.id);
  });
  it('el endpoint inicia un borrado real y el resguardo funciona después de cerrar la sesión', async () => {
    const owner = await createOwner();
    await createKnowledgeDocuments(service, owner.id).upload(
      new File(['HTTP delete account content'], 'mail055-http.txt', {
        type: 'text/plain',
      }),
    );
    const response = await post(owner, {
      action: 'delete_account',
      confirmation: 'ELIMINAR MI CUENTA',
      email: owner.email,
    });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    const receiptCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('account-deletion-receipt='))!
      .split(';')[0];
    expect(receiptCookie).toBeTruthy();
    expect(response.headers.get('cache-control')).toContain('no-store');
    let completed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await fetch(`${origin}/api/account/deletion`, {
        headers: { cookie: receiptCookie },
      });
      expect(result.status).toBe(200);
      const state = await result.json();
      if (state.status === 'COMPLETED') {
        completed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(completed).toBe(true);
    expect((await fetch(`${origin}/api/account/deletion`)).status).toBe(404);
    expect(
      (
        await fetch(`${origin}/api/account`, {
          headers: { cookie: cookies(owner) },
        })
      ).status,
    ).toBe(401);
    expect(
      (await service.auth.admin.getUserById(owner.id)).data.user,
    ).toBeNull();
  });
  it('no inicia el borrado hasta que la reserva de una carga en curso haya vencido', async () => {
    const owner = await createOwner();
    await assertQuery(
      service.rpc('reserve_source_document', {
        p_user_id: owner.id,
        p_name: 'loading.txt',
        p_mime_type: 'text/plain',
        p_byte_size: 10,
        p_sha256: 'a'.repeat(64),
      }),
    );
    const receipt = randomBytes(32).toString('hex'),
      id = await createAccountLifecycleRepository(
        service,
        owner.id,
      ).requestDeletion(receipt);
    const store = createAccountDeletionStore(service, async () => {});
    expect(await store.claim(id)).toBeNull();
    expect((await getDeletionReceipt(service, receipt)).status).toBe('QUEUED');
    expect(
      (
        await service.rpc('complete_indexed_source_document', {
          p_user_id: owner.id,
          p_document_id: crypto.randomUUID(),
          p_text: 'late',
          p_index: {},
        })
      ).data,
    ).toBe(false);
    await assertQuery(
      service
        .from('account_deletion_requests')
        .update({ next_attempt_at: '2000-01-01T00:00:00Z' })
        .eq('id', id),
    );
    expect(
      await runAccountDeletions(store, { requestId: id, limit: 1 }),
    ).toEqual({
      completed: 1,
      failed: false,
    });
  });
});
