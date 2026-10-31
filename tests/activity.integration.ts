import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { gmailScopes } from '@/config/google';
import { createActivityRepository } from '@/db/activity';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import type { ActivityFeed, ActivityDetail } from '@/modules/workflow/activity';
import { seedActivityJob, seedActivitySource } from './fixtures/activity-store';
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
  email: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
}[] = [];
const cookies = (index = 0) =>
  [...owners[index].jar].map(([name, value]) => `${name}=${value}`).join('; ');
let skipped: Awaited<ReturnType<typeof seedActivityJob>>,
  failed: typeof skipped,
  draft: typeof skipped,
  foreign: typeof skipped,
  source: Awaited<ReturnType<typeof seedActivitySource>>;
const request = (path: string, index = 0) =>
  fetch(`${origin}${path}`, { headers: { cookie: cookies(index) } });
async function feed(query = ''): Promise<ActivityFeed> {
  const response = await request(`/api/activity${query}`);
  expect(response.status).toBe(200);
  return response.json();
}
async function detail(id: string): Promise<ActivityDetail> {
  const response = await request(`/api/activity/${id}`);
  expect(response.status).toBe(200);
  return response.json();
}
describe('MAIL-054 actividad privada y trazabilidad con Supabase real', () => {
  beforeAll(async () => {
    if (new URL(url).origin !== 'http://127.0.0.1:55321')
      throw new Error('Solo Supabase local');
    for (let index = 0; index < 2; index++) {
      const email = `mail054-${crypto.randomUUID()}@example.invalid`,
        password = `Test-${crypto.randomUUID()}`;
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
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
      owners.push({
        id: created.data.user!.id,
        accountId: '',
        email,
        jar,
        client,
      });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
      const account = await service
        .from('gmail_accounts')
        .insert({
          user_id: owners[index].id,
          email,
          status: 'CONNECTED',
          encrypted_refresh_token: '\\x74657374',
          scope_set: [...gmailScopes],
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owners[index].accountId = account.data!.id;
    }
    skipped = await seedActivityJob(service, owners[0], { status: 'SKIPPED' });
    failed = await seedActivityJob(service, owners[0], { status: 'FAILED' });
    draft = await seedActivityJob(service, owners[0], {
      status: 'DRAFT_CREATED',
    });
    foreign = await seedActivityJob(service, owners[1], {
      threadId: 'FOREIGN_PRIVATE_THREAD_ID',
    });
    source = await seedActivitySource(service, owners[0], draft);
    for (let index = 0; index < 23; index++)
      await seedActivityJob(service, owners[0], {
        createdAt: '2026-10-01T00:00:00.123456Z',
      });
    expect(
      (
        await service.from('processing_runs').insert({
          user_id: owners[0].id,
          gmail_account_id: owners[0].accountId,
          status: 'FAILED',
          error_code: 'SYNC_GOOGLE_TIMEOUT_ATTEMPTS',
          started_at: '2026-10-01T10:00:00Z',
          finished_at: '2026-10-01T10:00:10Z',
          messages_detected: 2,
          error_count: 1,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await service.from('response_policy_events').insert({
          user_id: owners[0].id,
          gmail_account_id: owners[0].accountId,
          thread_id: skipped.threadId,
          target_message_id: skipped.targetMessageId,
          evaluation_id: crypto.randomUUID(),
          engine_version: 'mail045-v1',
          phase: 'PREFLIGHT',
          action: 'BLOCK',
          reasons: ['SENDER_BLOCKED'],
          policy_revision: 'a'.repeat(32),
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await service.from('response_validation_events').insert({
          user_id: owners[0].id,
          gmail_account_id: owners[0].accountId,
          thread_id: failed.threadId,
          target_message_id: failed.targetMessageId,
          evaluation_id: crypto.randomUUID(),
          validation: {
            version: 'mail046-v1',
            status: 'REVIEW_REQUIRED',
            bodyHash: 'a'.repeat(64),
            contextHash: 'b'.repeat(64),
            recipientHash: 'c'.repeat(64),
            evidenceHash: 'd'.repeat(64),
            claimCount: 1,
            issues: [
              {
                claimIndex: 0,
                kind: 'AMOUNT',
                reason: 'VALUE_MISMATCH',
                start: 0,
                end: 1,
              },
            ],
          },
        })
      ).error,
    ).toBeNull();
  });
  afterAll(async () => {
    for (const owner of owners) {
      for (const document of await createKnowledgeDocuments(
        service,
        owner.id,
      ).list())
        await createKnowledgeDocuments(service, owner.id).remove(document.id);
      await owner.client.auth.signOut({ scope: 'local' });
      expect((await service.auth.admin.deleteUser(owner.id)).error).toBeNull();
    }
  });
  it('protege la sesión y no permite consultar actividad de otra identidad', async () => {
    expect((await fetch(`${origin}/api/activity`)).status).toBe(401);
    expect((await fetch(`${origin}/api/activity/${draft.id}`)).status).toBe(
      401,
    );
    const response = await request(`/api/activity/${foreign.id}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'NOT_FOUND' });
    const foreignHtml = await (await request(`/activity/${foreign.id}`)).text();
    expect(foreignHtml).toContain('This page could not be found');
    expect(foreignHtml).not.toContain('FOREIGN_PRIVATE_THREAD_ID');
    expect(
      (
        await owners[1].client.rpc('get_activity_feed', {
          p_user_id: owners[0].id,
        })
      ).error?.code,
    ).toBe('42501');
    const own = await feed();
    expect(own.counts).toMatchObject({
      SKIPPED: 1,
      FAILED: 1,
      DRAFT_CREATED: 1,
      PENDING: 23,
    });
    expect(JSON.stringify(own)).not.toContain('FOREIGN_PRIVATE_THREAD_ID');
  });
  it('filtra mensajes omitidos, fallidos y borradores y explica sus motivos', async () => {
    expect((await feed('?status=SKIPPED')).jobs.map((job) => job.id)).toEqual([
      skipped.id,
    ]);
    expect((await feed('?status=FAILED')).jobs.map((job) => job.id)).toEqual([
      failed.id,
    ]);
    expect((await feed('?status=DRAFT_CREATED')).jobs[0].draft).toMatchObject({
      status: 'CREATED',
      warnings: ['HUMAN_REVIEW_REQUIRED'],
    });
    const response = await request('/activity?status=SKIPPED');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('El dominio está excluido.');
    expect(html).not.toContain('FOREIGN_PRIVATE_THREAD_ID');
  });
  it('avanza entre fechas iguales sin omitir registros ni repetir mensajes', async () => {
    const first = await feed();
    expect(first.jobs).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const next = await feed(`?${new URLSearchParams(first.nextCursor!)}`);
    expect(next.jobs).toHaveLength(6);
    expect(next.nextCursor).toBeNull();
    expect(
      new Set([...first.jobs, ...next.jobs].map((job) => job.id)).size,
    ).toBe(26);
  });
  it('expone estados y comprobaciones sin copiar correos, hashes ni identidades históricas', async () => {
    const response = await request(`/api/activity/${draft.id}`);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const value = (await response.json()) as ActivityDetail;
    expect(value.sources).toEqual([
      { kind: 'THREAD_MESSAGE' },
      { kind: 'HISTORICAL_MESSAGE' },
      {
        kind: 'KNOWLEDGE_FRAGMENT',
        sourceTitle: 'Manual MAIL-054',
        documentName: 'manual-mail054.txt',
        version: 1,
        currentVersion: 1,
        available: true,
      },
    ]);
    expect(value.events.map((event) => event.to)).toEqual([
      'PENDING',
      'CLASSIFYING',
      'GENERATING',
      'DRAFT_CREATED',
    ]);
    const policy = await detail(skipped.id);
    expect(policy.policies).toMatchObject([
      { action: 'BLOCK', reasons: ['SENDER_BLOCKED'] },
    ]);
    const factual = await detail(failed.id);
    expect(factual.validations).toMatchObject([
      {
        status: 'REVIEW_REQUIRED',
        claims: 1,
        issues: [{ kind: 'AMOUNT', reason: 'VALUE_MISMATCH' }],
      },
    ]);
    expect(JSON.stringify([value, policy, factual])).not.toMatch(
      /MAIL054_BODY_SENTINEL|OTHER_PRIVATE_MESSAGE_ID|bodyHash|contextHash|recipientHash|evidenceHash|encrypted_refresh_token|delivery_intent|chunkId|source_message_ids/,
    );
    const html = await (await request(`/activity/${draft.id}`)).text();
    expect(html).toContain('Fuentes empleadas');
    expect(html).toContain('Manual MAIL-054');
    expect(html).toContain('authuser=');
    expect(html).not.toContain('MAIL054_BODY_SENTINEL');
  });
  it('mantiene la referencia y avisa cuando una fuente se desactiva o elimina el documento', async () => {
    await createKnowledgeSources(service, owners[0].id).mutate({
      action: 'save_source',
      id: source.source.id,
      title: 'Manual MAIL-054',
      priority: 0,
      enabled: false,
    });
    expect((await detail(draft.id)).sources[2]).toMatchObject({
      available: false,
      documentName: 'manual-mail054.txt',
    });
    await createKnowledgeDocuments(service, owners[0].id).remove(
      source.document.id,
    );
    expect((await detail(draft.id)).sources[2]).toMatchObject({
      available: false,
      documentName: null,
      version: 1,
    });
  });
  it('acota el historial de eventos y señala los registros que no caben en el detalle', async () => {
    expect(
      (
        await service.from('email_job_events').insert(
          Array.from({ length: 110 }, () => ({
            email_job_id: skipped.id,
            user_id: owners[0].id,
            gmail_account_id: owners[0].accountId,
            from_status: 'PENDING',
            to_status: 'CLASSIFYING',
          })),
        )
      ).error,
    ).toBeNull();
    const value = await detail(skipped.id);
    expect(value.events).toHaveLength(100);
    expect(value.eventsTruncated).toBe(true);
  });
  it('rechaza filtros e identificadores mal formados', async () => {
    for (const query of [
      '?status=unknown',
      '?status=ALL&status=FAILED',
      '?userId=other',
      '?before=2026-10-31T10:00:00Z',
    ])
      expect((await request(`/api/activity${query}`)).status).toBe(400);
    expect((await request('/api/activity/not-a-uuid')).status).toBe(400);
    expect((await request('/activity?status=unknown')).status).toBe(200);
    expect(await (await request('/activity?status=unknown')).text()).toContain(
      'Los filtros de actividad no son válidos',
    );
  });
  it('permite consultar la actividad propia tras pausar o desconectar Gmail, sin acceso al proveedor', async () => {
    for (const status of ['PAUSED', 'DISCONNECTED'] as const) {
      expect(
        (
          await service
            .from('gmail_accounts')
            .update({ status })
            .eq('id', owners[0].accountId)
        ).error,
      ).toBeNull();
      expect((await feed()).overview.accountStatus).toBe(status);
      expect((await detail(draft.id)).job.id).toBe(draft.id);
    }
    expect(
      (await createActivityRepository(service, owners[0].id).feed()).counts
        .DRAFT_CREATED,
    ).toBe(1);
  });
});
