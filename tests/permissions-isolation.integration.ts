import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { gmailScopes } from '@/config/google';
import { createAuthorizedTestUser } from './fixtures/privacy';
import { writingProfileFixture } from './fixtures/writing-profile';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createGmailCredentialRepository } from '@/db/gmail-credential-repository';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { createEmailJobStore } from '@/db/email-jobs';
import { createWritingProfileRepository } from '@/db/writing-profiles';
import { createGenerationRetentionRepository } from '@/db/generation-retention';
import { openWorkerDataAccess } from '@/worker/data-access';
import type { EmailJob } from '@/worker/email-jobs';

const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
type Owner = {
  id: string;
  email: string;
  accountId: string;
  runId: string;
  documentId: string;
  sourceId: string;
  ruleId: string;
  profileRevision: string;
  privateText: string;
  job: EmailJob;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
};
const owners: Owner[] = [];
function request(
  index: number,
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      origin,
      ...(index >= 0
        ? {
            cookie: [...owners[index].jar]
              .map(([k, v]) => `${k}=${v}`)
              .join('; '),
          }
        : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function snapshot(owner: Owner) {
  const documents = await service
    .from('source_documents')
    .select('*')
    .eq('id', owner.documentId)
    .single();
  const source = await service
    .from('knowledge_sources')
    .select('*')
    .eq('id', owner.sourceId)
    .single();
  const rule = await service
    .from('source_rules')
    .select('*')
    .eq('id', owner.ruleId)
    .single();
  const account = await service
    .from('gmail_accounts')
    .select('*')
    .eq('id', owner.accountId)
    .single();
  const profile = await service
    .from('style_profiles')
    .select('*')
    .eq('user_id', owner.id);
  const job = await service
    .from('email_jobs')
    .select('*')
    .eq('id', owner.job.id)
    .single();
  for (const value of [documents, source, rule, account, profile, job])
    expect(value.error).toBeNull();
  return {
    document: documents.data,
    source: source.data,
    rule: rule.data,
    account: account.data,
    profiles: profile.data,
    job: job.data,
  };
}

describe('MAIL-063 auditoría de aislamiento con tres usuarios, sesiones reales y servicio privilegiado', () => {
  beforeAll(async () => {
    if (url !== 'http://127.0.0.1:55321')
      throw new Error('Solo Supabase local');
    for (let index = 0; index < 3; index++) {
      const email = `mail063-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      const created = await createAuthorizedTestUser(service, {
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const jar = new Map<string, string>();
      const client = createAuthClient({
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) {
            if (value) jar.set(name, value);
            else jar.delete(name);
          }
        },
      });
      const owner: Owner = {
        id: created.data.user!.id,
        email,
        accountId: '',
        runId: '',
        documentId: '',
        sourceId: '',
        ruleId: '',
        profileRevision: '',
        privateText: `Contenido confidencial propietario ${crypto.randomUUID()}. Tarifa reservada: 963 euros.`,
        job: {} as EmailJob,
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
          encrypted_refresh_token: 'synthetic',
          scope_set: [...gmailScopes],
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owner.accountId = account.data!.id;
      const run = await service
        .from('processing_runs')
        .insert({ user_id: owner.id, gmail_account_id: owner.accountId })
        .select('id')
        .single();
      expect(run.error).toBeNull();
      owner.runId = run.data!.id;
      const documents = createKnowledgeDocuments(service, owner.id),
        sources = createKnowledgeSources(service, owner.id);
      owner.documentId = (
        await documents.upload(
          new File([owner.privateText], `privado-${index}.txt`, {
            type: 'text/plain',
          }),
        )
      ).id;
      owner.sourceId = (
        await sources.mutate({
          action: 'save_source',
          title: `Fuente privada ${owner.id}`,
          priority: 1,
          enabled: true,
        })
      ).id;
      await sources.mutate({
        action: 'assign_document',
        documentId: owner.documentId,
        sourceId: owner.sourceId,
      });
      owner.ruleId = (
        await sources.mutate({
          action: 'save_rule',
          title: 'Regla privada',
          intent: '*',
          terms: [],
          priority: 1,
          enabled: true,
          allowEmailHistory: false,
          primarySourceIds: [owner.sourceId],
          fallbackSourceIds: [],
          excludedSourceIds: [],
        })
      ).id;
      const profiles = createWritingProfileRepository(
        service,
        owner.id,
        owner.accountId,
      );
      const profile = await profiles.save({
        profile: writingProfileFixture(),
        model: 'synthetic',
        sampleSize: 1,
        inputTokens: 1,
        outputTokens: 1,
        warnings: [],
        sourceMessageIds: ['sharedMessage63'],
      });
      owner.profileRevision = (
        await profiles.confirm(profile.revision)
      ).revision;
      const jobId = crypto.randomUUID(),
        leaseId = crypto.randomUUID();
      expect(
        (
          await service.from('email_jobs').insert({
            id: jobId,
            user_id: owner.id,
            gmail_account_id: owner.accountId,
            thread_id: 'sharedThread63',
            target_message_id: 'sharedMessage63',
          })
        ).error,
      ).toBeNull();
      const stamp = new Date().toISOString();
      expect(
        (
          await service
            .from('email_jobs')
            .update({
              status: 'CLASSIFYING',
              started_at: stamp,
              classification_started_at: stamp,
              attempt_count: 1,
              lease_id: leaseId,
              lease_expires_at: new Date(Date.now() + 300000).toISOString(),
            })
            .eq('id', jobId)
        ).error,
      ).toBeNull();
      owner.job = {
        id: jobId,
        userId: owner.id,
        gmailAccountId: owner.accountId,
        threadId: 'sharedThread63',
        targetMessageId: 'sharedMessage63',
        status: 'CLASSIFYING',
        leaseId,
        classification: null,
        draftId: null,
      };
    }
  }, 60000);
  afterAll(async () => {
    for (const owner of owners) {
      if (owner.documentId)
        expect(
          (
            await service.storage
              .from('knowledge-documents')
              .remove([`${owner.id}/${owner.documentId}`])
          ).error,
        ).toBeNull();
      await owner.client.auth.signOut({ scope: 'local' });
      // Remove dependent rules and documents before Auth's owner cascade.
      expect(
        (await service.from('source_rules').delete().eq('user_id', owner.id))
          .error,
      ).toBeNull();
      expect(
        (
          await service
            .from('source_documents')
            .delete()
            .eq('user_id', owner.id)
        ).error,
      ).toBeNull();
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });

  const privateReads = [
    '/api/account',
    '/api/gmail-account',
    '/api/processing-runs',
    '/api/activity',
    '/api/analytics',
    '/api/knowledge/documents',
    '/api/knowledge/sources',
    '/api/style',
    '/api/onboarding',
    '/api/account/lifecycle',
    '/api/privacy',
    '/api/privacy/export',
    '/api/learning/style',
  ];
  it.each(privateReads)(
    'rechaza una sesión ausente o una cookie inventada en %s',
    async (path) => {
      for (const headers of [
        {},
        { cookie: 'sb-forged-auth-token=forged' },
      ] as Record<string, string>[]) {
        const response = await request(-1, path, 'GET', undefined, headers);
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toContain('no-store');
        const body = await response.text();
        for (const owner of owners)
          expect(body).not.toContain(owner.privateText);
      }
    },
  );

  describe.each([0, 1])('propietario %i frente al otro usuario', (index) => {
    const foreignRoutes = [
      ['original', 'GET'],
      ['chunks', 'GET'],
      ['index', 'POST'],
      ['validity', 'PATCH'],
      ['audience', 'PATCH'],
      ['remove', 'DELETE'],
      ['search', 'GET'],
      ['run', 'GET'],
      ['job', 'GET'],
    ] as const;
    it.each(foreignRoutes)(
      'rechaza %s (%s) igual que un recurso inexistente',
      async (kind, method) => {
        const other = owners[1 - index];
        const target = (id: string) => {
          if (kind === 'run') return `/api/processing-runs/${id}`;
          if (kind === 'job') return `/api/activity/${id}`;
          if (kind === 'search')
            return `/api/knowledge/search?q=tarifa&documentId=${id}`;
          return `/api/knowledge/documents/${id}${['chunks', 'index', 'audience'].includes(kind) ? `/${kind}` : ''}`;
        };
        const id =
          kind === 'run'
            ? other.runId
            : kind === 'job'
              ? other.job.id
              : other.documentId;
        const body =
          kind === 'validity'
            ? { validFrom: '2026-01-01', validUntil: '2030-01-01' }
            : kind === 'audience'
              ? { kind: 'GENERAL', key: '' }
              : undefined;
        const before = await snapshot(other);
        const response = await request(index, target(id), method, body),
          missing = await request(
            index,
            target(crypto.randomUUID()),
            method,
            body,
          );
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual(await missing.json());
        expect(missing.status).toBe(404);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(await snapshot(other)).toEqual(before);
      },
    );

    it('permite el original propio y bloquea Storage, rutas cruzadas y firmas para documentos ajenos', async () => {
      const own = owners[index],
        other = owners[1 - index];
      expect(
        await (
          await request(index, `/api/knowledge/documents/${own.documentId}`)
        ).text(),
      ).toBe(own.privateText);
      const storage = own.client.storage.from('knowledge-documents');
      expect(
        (await storage.download(`${own.id}/${own.documentId}`)).error,
      ).toBeNull();
      for (const key of [
        `${other.id}/${other.documentId}`,
        `${own.id}/${other.documentId}`,
        `${other.id}/${own.documentId}`,
        `${own.id}/../${other.id}/${other.documentId}`,
      ]) {
        expect((await storage.download(key)).data).toBeNull();
        expect((await storage.createSignedUrl(key, 60)).data).toBeNull();
      }
      const unsigned = await fetch(
        `${url}/storage/v1/object/public/knowledge-documents/${other.id}/${other.documentId}`,
      );
      expect(unsigned.ok).toBe(false);
      const write = await storage.upload(
        `${other.id}/${other.documentId}`,
        new Blob(['intrusión']),
        { upsert: true },
      );
      expect(write.error).not.toBeNull();
      const original = await service.storage
        .from('knowledge-documents')
        .download(`${other.id}/${other.documentId}`);
      expect(original.error).toBeNull();
      expect(await original.data!.text()).toBe(other.privateText);
    });

    it.each([
      'save_source',
      'delete_source',
      'save_rule',
      'delete_rule',
      'assign_document',
      'foreign_source',
    ] as const)('no modifica recursos ajenos con %s', async (action) => {
      const own = owners[index],
        other = owners[1 - index],
        before = await snapshot(other);
      const operation =
        action === 'save_source'
          ? {
              action,
              id: other.sourceId,
              title: 'Intrusión',
              priority: 0,
              enabled: false,
            }
          : action === 'save_rule'
            ? {
                action,
                id: other.ruleId,
                title: 'Intrusión',
                intent: '*',
                terms: [],
                priority: 0,
                enabled: false,
                allowEmailHistory: true,
                primarySourceIds: [own.sourceId],
                fallbackSourceIds: [],
                excludedSourceIds: [],
              }
            : action === 'assign_document'
              ? { action, documentId: other.documentId, sourceId: own.sourceId }
              : action === 'foreign_source'
                ? {
                    action: 'assign_document',
                    documentId: own.documentId,
                    sourceId: other.sourceId,
                  }
                : {
                    action,
                    id:
                      action === 'delete_source'
                        ? other.sourceId
                        : other.ruleId,
                  };
      const ownBefore = await snapshot(own);
      const response = await request(
        index,
        '/api/knowledge/sources',
        'POST',
        operation,
      );
      expect(response.status).toBe(404);
      expect(await snapshot(other)).toEqual(before);
      expect(await snapshot(own)).toEqual(ownBefore);
    });

    it('no concede ni retira la retención de la cuenta Gmail ajena', async () => {
      const other = owners[1 - index];
      const enabled = {
        accountId: other.accountId,
        enabled: true,
        retentionHours: 1,
        noticeVersion: 'mail056-v1',
      };
      expect(
        (
          await request(
            index,
            `/api/learning/retention?accountId=${other.accountId}`,
          )
        ).status,
      ).toBe(404);
      for (const body of [
        enabled,
        { accountId: other.accountId, enabled: false },
      ])
        expect(
          (await request(index, '/api/learning/retention', 'PUT', body)).status,
        ).toBe(403);
      expect(
        (
          await service
            .from('generation_content_authorizations')
            .select('*')
            .eq('user_id', other.id)
        ).data,
      ).toEqual([]);
    });

    it('no usa la revisión del perfil ajeno para modificar o confirmar el estilo propio', async () => {
      const other = owners[1 - index],
        before = await snapshot(other),
        ownBefore = await snapshot(owners[index]);
      const response = await request(index, '/api/style', 'PUT', {
        action: 'confirm',
        scope: { kind: 'GENERAL', key: '' },
        generalRevision: other.profileRevision,
        profileRevision: other.profileRevision,
        expectedRevisions: [],
        reviewed: true,
      });
      expect(response.status).toBe(409);
      expect(await snapshot(other)).toEqual(before);
      expect(await snapshot(owners[index])).toEqual(ownBefore);
    });

    it('ignora suplantaciones en query/cabeceras y exporta únicamente al titular autenticado', async () => {
      const own = owners[index],
        other = owners[1 - index];
      const response = await request(
        index,
        `/api/privacy/export?userId=${other.id}&accountId=${other.accountId}`,
        'GET',
        undefined,
        { 'x-user-id': other.id, 'x-account-id': other.accountId },
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(own.privateText);
      expect(text).toContain(own.email);
      expect(text).not.toContain(other.privateText);
      expect(text).not.toContain(other.email);
      expect(text).not.toContain(other.accountId);
      expect(text).not.toContain('encrypted_refresh_token');
    });

    it('no borra la cuenta ajena al presentar su correo ni acepta un propietario inyectado', async () => {
      const own = owners[index],
        other = owners[1 - index];
      for (const body of [
        {
          action: 'delete_account',
          confirmation: 'ELIMINAR MI CUENTA',
          email: other.email,
        },
        {
          action: 'delete_account',
          confirmation: 'ELIMINAR MI CUENTA',
          email: own.email,
          userId: other.id,
        },
        {
          action: 'reset_style',
          confirmation: 'BORRAR ESTILO',
          userId: other.id,
        },
      ])
        expect(
          (await request(index, '/api/account/lifecycle', 'POST', body)).status,
        ).toBe(400);
      expect(
        (
          await service
            .from('account_deletion_requests')
            .select('id')
            .in('user_id', [own.id, other.id])
        ).data,
      ).toEqual([]);
      expect(
        (await service.auth.admin.getUserById(other.id)).data.user?.id,
      ).toBe(other.id);
    });

    it('el worker rechaza cuentas, credenciales y trabajos mezclados incluso con service_role', async () => {
      const own = owners[index],
        other = owners[1 - index],
        before = await snapshot(other);
      await expect(
        openWorkerDataAccess(service, {
          userId: own.id,
          gmailAccountId: other.accountId,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        createGmailCredentialRepository(service, own.id, other.accountId).get(),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        createWritingProfileRepository(service, own.id, other.accountId).get(),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        createDraftGenerationRepository(service, own.id, other.accountId).find(
          'sharedMessage63',
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        createGenerationRetentionRepository(service, own.id).get(
          other.accountId,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const jobs = createEmailJobStore(service);
      const forged = {
        ...other.job,
        userId: own.id,
        gmailAccountId: own.accountId,
      };
      expect(await jobs.renew(forged, 120)).toBe(false);
      await expect(
        jobs.advance(forged, {
          status: 'FAILED',
          reasonCode: 'MODEL_UNAVAILABLE',
        }),
      ).rejects.toMatchObject({ code: 'LEASE_LOST' });
      expect(
        await jobs.retry(
          { userId: own.id, gmailAccountId: own.accountId },
          other.job.id,
        ),
      ).toBe(false);
      expect(await createKnowledgeDocuments(service, own.id).list()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: own.documentId }),
        ]),
      );
      await expect(
        createKnowledgeDocuments(service, own.id).download(other.documentId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await snapshot(other)).toEqual(before);
    });
  });

  it('una sesión emitida antes de deshabilitar el tercer usuario pierde lecturas directas y acceso HTTP', async () => {
    const owner = owners[2];
    expect(
      (await owner.client.from('email_job_events').select('id')).data?.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await service
          .from('users')
          .update({ status: 'DISABLED' })
          .eq('id', owner.id)
      ).error,
    ).toBeNull();
    for (const table of [
      'email_jobs',
      'email_job_events',
      'source_documents',
      'source_document_texts',
      'knowledge_chunks',
      'style_profiles',
    ] as const) {
      const result = await owner.client.from(table).select('user_id');
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    expect(
      (
        await owner.client.storage
          .from('knowledge-documents')
          .download(`${owner.id}/${owner.documentId}`)
      ).data,
    ).toBeNull();
    for (const path of [
      '/api/account',
      '/api/privacy/export',
      `/api/knowledge/documents/${owner.documentId}`,
      '/api/activity',
    ])
      expect((await request(2, path)).status).toBe(403);
    await expect(
      openWorkerDataAccess(service, {
        userId: owner.id,
        gmailAccountId: owner.accountId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
