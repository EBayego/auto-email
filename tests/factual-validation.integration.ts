import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createResponseValidationRepository } from '@/db/response-validation';
import { createDraftGenerationRepository } from '@/db/draft-generations';
import { createReplyKnowledgeResolver } from '@/modules/response/knowledge-context';
import { createReplyDraftForThread } from '@/poc/create-reply-draft';
import { gmailScopes } from '@/config/google';
import { draftFixture } from './fixtures/drafts';
import { createEmailFixtures } from './fixtures/emails';
import { readyResponse, supportedResponse } from './fixtures/responses';

const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const owners: {
  id: string;
  email: string;
  accountId: string;
  sourceId: string;
  documentId: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
}[] = [];
const sourceText = 'El precio de Atlas es de 125 euros.';
const docs = (i = 0) => createKnowledgeDocuments(service, owners[i].id);
const sources = () => createKnowledgeSources(service, owners[0].id);
function request(documentId: string, body: unknown, i = 0) {
  return fetch(`${origin}/api/knowledge/documents/${documentId}/audience`, {
    method: 'PATCH',
    headers: {
      origin,
      'content-type': 'application/json',
      cookie: [...owners[i].jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
}
async function generate(wrong = false, copies: readonly string[] = []) {
  const owner = owners[0],
    f = draftFixture();
  const thread = createEmailFixtures(
    'Hola, ¿cuál es el precio de Atlas? Gracias.',
  ).pending;
  if (copies.length)
    thread.messages[0].payload.headers.push(
      { name: 'Cc', value: copies.join(', ') },
      { name: 'Bcc', value: 'hidden@example.invalid' },
    );
  for (const message of thread.messages)
    for (const header of message.payload!.headers!)
      header.value = header.value.replaceAll(
        'owner@example.invalid',
        owner.email,
      );
  f.gmail.getThread.mockResolvedValue(thread);
  const claim = wrong ? 'El precio de Atlas es de 90 euros.' : sourceText;
  f.text.generate.mockImplementation(async (call) => ({
    text: JSON.stringify(
      call.jsonSchema?.name === 'response_verification_v1'
        ? supportedResponse()
        : {
            ...readyResponse(),
            bodyText: claim,
            evidence: [{ knowledgeIndex: 0, quote: sourceText, claim }],
          },
    ),
    inputTokens: 10,
    outputTokens: 5,
  }));
  const repository = sources();
  const report = await createReplyDraftForThread({
    ...f,
    selection: {
      ...f.selection,
      accountId: owner.accountId,
      mailboxAddress: owner.email,
    },
    styleExamplesLimit: 0,
    retrieveKnowledge: createReplyKnowledgeResolver({
      configuration: repository.list,
      classify: async () => ({ intent: 'REQUEST_INFORMATION' }),
      retriever: repository,
    }),
    factualValidation: createResponseValidationRepository(
      service,
      owner.id,
      owner.accountId,
    ),
    store: createDraftGenerationRepository(service, owner.id, owner.accountId),
  });
  return { report, f };
}
describe('MAIL-046 validación factual, destinatarios y persistencia real', () => {
  it('MAIL-047 conserva Para/Cc y crea el borrador de grupo con validación persistente', async () => {
    const { report, f } = await generate(false, ['copy@example.invalid']);
    expect(report.draft?.status).toBe('CREATED');
    const raw = Buffer.from(
      f.gmail.createDraft.mock.calls[0][0].raw,
      'base64url',
    ).toString();
    expect(raw).toContain('Cc: copy@example.invalid');
    expect(raw).not.toContain('Bcc:');
    expect(raw).not.toContain('hidden@example.invalid');
    const row = await service
      .from('draft_generations')
      .select('factual_validation')
      .eq('user_id', owners[0].id)
      .single();
    expect(row.error).toBeNull();
    expect(row.data?.factual_validation).toMatchObject({ status: 'SUPPORTED' });
  });
  it('MAIL-047 no comparte una tarifa privada con una persona en Cc', async () => {
    await docs().setAudience(owners[0].documentId, {
      kind: 'RECIPIENT',
      key: 'contact@example.invalid',
    });
    const { report, f } = await generate(false, ['copy@example.invalid']);
    expect(report.generation?.status).toBe('INSUFFICIENT_CONTEXT');
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(f.gmail.createDraft).not.toHaveBeenCalled();
  });
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `factual46-${crypto.randomUUID()}@example.invalid`,
        password = `Factual46-${crypto.randomUUID()}!`;
      const user = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(user.error).toBeNull();
      const id = user.data.user!.id,
        jar = new Map<string, string>();
      const client = createAuthClient(
        {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (values) => {
            for (const c of values) {
              if (!c.value || c.options.maxAge === 0) jar.delete(c.name);
              else jar.set(c.name, c.value);
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
        id,
        email,
        accountId: '',
        sourceId: '',
        documentId: '',
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
          user_id: id,
          email,
          status: 'CONNECTED',
          encrypted_refresh_token: '\\x010203',
          scope_set: [...gmailScopes],
        })
        .select('id')
        .single();
      expect(account.error).toBeNull();
      owner.accountId = account.data!.id;
      const repository = createKnowledgeSources(service, id);
      owner.sourceId = (
        await repository.mutate({
          action: 'save_source',
          title: 'Tarifas Atlas',
          priority: 0,
          enabled: true,
        })
      ).id;
      const document = await docs(i).upload(
        new File([sourceText], 'tarifas.txt', { type: 'text/plain' }),
      );
      owner.documentId = document.id;
      await repository.mutate({
        action: 'assign_document',
        documentId: document.id,
        sourceId: owner.sourceId,
      });
      await docs(i).setValidity(document.id, {
        validFrom: '2020-01-01',
        validUntil: '2099-12-31',
      });
      await repository.mutate({
        action: 'save_rule',
        title: 'Precios',
        intent: 'REQUEST_INFORMATION',
        terms: [],
        priority: 0,
        enabled: true,
        allowEmailHistory: false,
        primarySourceIds: [owner.sourceId],
        fallbackSourceIds: [],
        excludedSourceIds: [],
      });
    }
  });
  beforeEach(async () => {
    await service
      .from('draft_generations')
      .delete()
      .eq('user_id', owners[0].id);
    // Service role intentionally has append-only event grants. Cascading a
    // temporary account in afterAll removes these test records.
    await docs().setAudience(owners[0].documentId, {
      kind: 'GENERAL',
      key: '',
    });
  });
  afterAll(async () => {
    for (let i = 0; i < owners.length; i++) {
      if (owners[i].documentId) await docs(i).remove(owners[i].documentId);
      expect(
        (
          await service
            .from('source_rules')
            .delete()
            .eq('user_id', owners[i].id)
        ).error,
      ).toBeNull();
      await owners[i].client.auth.signOut();
      expect(
        (await service.auth.admin.deleteUser(owners[i].id)).error,
      ).toBeNull();
    }
  });
  it('crea un borrador respaldado y conserva hashes y procedencia, sin contenido', async () => {
    const { report, f } = await generate();
    expect(report.generation?.status).toBe('READY');
    expect(report.draft?.status).toBe('CREATED');
    expect(f.gmail.createDraft).toHaveBeenCalledOnce();
    const rows = await service
      .from('draft_generations')
      .select('factual_validation,sources_used')
      .eq('user_id', owners[0].id)
      .single();
    expect(rows.error).toBeNull();
    expect(rows.data?.factual_validation).toMatchObject({
      version: 'mail046-v1',
      status: 'SUPPORTED',
      claimCount: 1,
      issues: [],
    });
    expect(rows.data?.sources_used).toEqual([
      expect.objectContaining({
        kind: 'KNOWLEDGE_FRAGMENT',
        documentId: owners[0].documentId,
      }),
    ]);
    expect(JSON.stringify(rows.data)).not.toContain(sourceText);
  });
  it('bloquea un importe inventado y audita el fallo aunque el modelo lo aprobara', async () => {
    const { report, f } = await generate(true);
    expect(report.generation?.status).toBe('INSUFFICIENT_CONTEXT');
    expect(report.draft).toBeNull();
    expect(f.gmail.createDraft).not.toHaveBeenCalled();
    expect(f.text.generate).toHaveBeenCalledOnce();
    const events = await owners[0].client
      .from('response_validation_events')
      .select('validation')
      .eq('user_id', owners[0].id);
    expect(events.error).toBeNull();
    const failed = events.data
      ?.map((e) => e.validation)
      .find(
        (v) =>
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          v.status === 'REVIEW_REQUIRED',
      );
    expect(failed).toMatchObject({
      status: 'REVIEW_REQUIRED',
      issues: [
        expect.objectContaining({ reason: 'VALUE_MISMATCH', kind: 'AMOUNT' }),
      ],
    });
    expect(JSON.stringify(failed)).not.toContain(sourceText);
    expect(
      (
        await service
          .from('draft_generations')
          .select('id')
          .eq('user_id', owners[0].id)
      ).data,
    ).toEqual([]);
  });
  it('RLS impide que otro usuario lea los resultados de validación', async () => {
    await generate(true);
    const own = await owners[0].client
      .from('response_validation_events')
      .select('id');
    const foreign = await owners[1].client
      .from('response_validation_events')
      .select('id')
      .eq('user_id', owners[0].id);
    expect(own.data?.length).toBeGreaterThan(0);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
  });
  it('el API solo permite cambiar el alcance de documentos propios', async () => {
    expect(
      (
        await request(owners[0].documentId, {
          kind: 'RECIPIENT',
          key: 'CONTACT@example.invalid',
        })
      ).status,
    ).toBe(204);
    expect(
      (await request(owners[0].documentId, { kind: 'GENERAL', key: '' }, 1))
        .status,
    ).toBe(404);
    expect(
      (
        await request(owners[0].documentId, {
          kind: 'DOMAIN',
          key: '*.example.invalid',
        })
      ).status,
    ).toBe(400);
    const metadata = (await docs().list()).find(
      (d) => d.id === owners[0].documentId,
    );
    expect(metadata).toMatchObject({
      audience_kind: 'RECIPIENT',
      audience_key: 'contact@example.invalid',
    });
  });
  it('excluye datos de otro destinatario antes de llamar al generador', async () => {
    await docs().setAudience(owners[0].documentId, {
      kind: 'RECIPIENT',
      key: 'another@example.invalid',
    });
    const { report, f } = await generate();
    expect(report.generation?.status).toBe('INSUFFICIENT_CONTEXT');
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(f.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('recupera datos del destinatario autorizado y no los expone en una búsqueda genérica', async () => {
    await docs().setAudience(owners[0].documentId, {
      kind: 'RECIPIENT',
      key: 'contact@example.invalid',
    });
    const generic = await sources().retrieve({
      question: '¿Cuál es el precio de Atlas?',
      intent: 'REQUEST_INFORMATION',
    });
    expect(generic.matches).toEqual([]);
    const { report } = await generate();
    expect(report.draft?.status).toBe('CREATED');
  });
});
