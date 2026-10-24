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
import { createAuthClient } from '@/modules/auth/client';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import { createResponseGenerator } from '@/modules/response/generator';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from './fixtures/responses';
import type { TextGenerationClient } from '@/providers/contracts';
import type {
  SourceOperation,
  SourceConfiguration,
} from '@/modules/source-router/sources';

const url = process.env.AUTO_EMAIL_TEST_URL!,
  origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  url,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
type Owner = {
  id: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
};
const owners: Owner[] = [];
const ids: string[] = [],
  documentIds: string[] = [];
let foreignSource: string, foreignDocument: string, ruleId: string;
const cookie = (i = 0) =>
  [...owners[i].jar].map(([k, v]) => `${k}=${v}`).join('; ');
function request(path: string, init: RequestInit = {}, i = 0) {
  return fetch(`${origin}/api/knowledge/${path}`, {
    ...init,
    headers: { origin, cookie: cookie(i), ...init.headers },
    redirect: 'manual',
  });
}
function mutate(operation: SourceOperation | Record<string, unknown>, i = 0) {
  return request(
    'sources',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(operation),
    },
    i,
  );
}
async function config(i = 0): Promise<SourceConfiguration> {
  const r = await request('sources', {}, i);
  expect(r.status).toBe(200);
  return r.json();
}
async function search(q = 'consulta', intent = 'REQUEST_INFORMATION', i = 0) {
  const r = await request(
    `search?${new URLSearchParams({ q, intent })}`,
    {},
    i,
  );
  expect(r.status).toBe(200);
  return r.json();
}
const initialRule = (): SourceOperation => ({
  action: 'save_rule',
  title: 'Tarifas de consulta',
  intent: 'REQUEST_INFORMATION',
  terms: ['consulta', 'precio', 'plazo'],
  priority: 100,
  enabled: true,
  allowEmailHistory: false,
  primarySourceIds: [ids[0]],
  fallbackSourceIds: [ids[1]],
  excludedSourceIds: [ids[2]],
});
describe('MAIL-038 registro privado y búsqueda según reglas', () => {
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `sources-${crypto.randomUUID()}@example.invalid`,
        password = `Source-${crypto.randomUUID()}!`;
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(created.error).toBeNull();
      const jar = new Map<string, string>();
      const client = createAuthClient({
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (values) => {
          for (const c of values) {
            if (c.options.maxAge === 0) jar.delete(c.name);
            else jar.set(c.name, c.value);
          }
        },
      });
      owners.push({ id: created.data.user!.id, jar, client });
      expect(
        (await client.auth.signInWithPassword({ email, password })).error,
      ).toBeNull();
    }
    const repository = createKnowledgeSources(service, owners[0].id),
      documents = createKnowledgeDocuments(service, owners[0].id);
    for (const [i, title] of [
      'Tarifas',
      'Respaldo',
      'Archivo excluido',
    ].entries()) {
      ids.push(
        (
          await repository.mutate({
            action: 'save_source',
            title,
            priority: i + 1,
            enabled: true,
          })
        ).id,
      );
      const text = [
        'Consulta vigente: 125 euros.',
        'Consulta de respaldo: 200 euros. Plazo de entrega: siete días.',
        'Consulta antigua: 999 euros. Plazo antiguo: 30 días.',
      ][i];
      const doc = await documents.upload(
        new File([text], `grupo${i}.txt`, { type: 'text/plain' }),
      );
      documentIds.push(doc.id);
      await repository.mutate({
        action: 'assign_document',
        documentId: doc.id,
        sourceId: ids[i],
      });
    }
    const other = createKnowledgeSources(service, owners[1].id);
    foreignSource = (
      await other.mutate({
        action: 'save_source',
        title: 'Privada ajena',
        priority: 1,
        enabled: true,
      })
    ).id;
    const doc = await createKnowledgeDocuments(service, owners[1].id).upload(
      new File(['Consulta privada de otro usuario.'], 'privada.txt', {
        type: 'text/plain',
      }),
    );
    foreignDocument = doc.id;
    await other.mutate({
      action: 'assign_document',
      documentId: doc.id,
      sourceId: foreignSource,
    });
  });
  beforeEach(async () => {
    expect(
      (await service.from('source_rules').delete().eq('user_id', owners[0].id))
        .error,
    ).toBeNull();
    const repository = createKnowledgeSources(service, owners[0].id);
    await repository.mutate({
      action: 'set_sufficiency_preferences',
      allowPartialDrafts: false,
    });
    for (const [i, id] of ids.entries()) {
      await createKnowledgeDocuments(service, owners[0].id).setValidity(
        documentIds[i],
        { validFrom: null, validUntil: null },
      );
      await repository.mutate({
        action: 'save_source',
        id,
        title: ['Tarifas', 'Respaldo', 'Archivo excluido'][i],
        priority: i + 1,
        enabled: true,
      });
      await repository.mutate({
        action: 'assign_document',
        documentId: documentIds[i],
        sourceId: id,
      });
    }
    ruleId = (
      await repository.mutate(
        initialRule() as Extract<SourceOperation, { action: 'save_rule' }>,
      )
    ).id;
  });
  afterAll(async () => {
    for (const owner of owners) {
      const docs = await service
        .from('source_documents')
        .select('id')
        .eq('user_id', owner.id);
      if (docs.data?.length)
        await service.storage
          .from('knowledge-documents')
          .remove(docs.data.map((d) => `${owner.id}/${d.id}`));
      await service.from('source_documents').delete().eq('user_id', owner.id);
      await service.auth.admin.deleteUser(owner.id);
    }
  });
  it('configura fuentes y reglas con el propietario de sesión y exige autenticación', async () => {
    const value = await config();
    expect(value.sources).toHaveLength(3);
    expect(value.rules[0]).toMatchObject({
      id: ruleId,
      allowEmailHistory: false,
      primarySourceIds: [ids[0]],
    });
    expect(
      (value.sources[0] as unknown as Record<string, unknown>).user_id,
    ).toBeUndefined();
    expect((await fetch(`${origin}/api/knowledge/sources`)).status).toBe(401);
    expect(
      (
        await request('sources', {
          method: 'POST',
          headers: { origin: 'https://evil.invalid' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await mutate({ ...initialRule(), userId: owners[1].id })).status,
    ).toBe(400);
  });
  it('MAIL-041 guarda la opción explícita por usuario y rechaza identidades inyectadas', async () => {
    const old = await config();
    expect(old.allowPartialDrafts).toBe(false);
    expect(
      (
        await mutate({
          action: 'set_sufficiency_preferences',
          allowPartialDrafts: true,
        })
      ).status,
    ).toBe(200);
    expect((await config()).allowPartialDrafts).toBe(true);
    expect((await config()).revision).not.toBe(old.revision);
    expect((await config(1)).allowPartialDrafts).toBe(false);
    expect(
      (
        await mutate({
          action: 'set_sufficiency_preferences',
          allowPartialDrafts: true,
          userId: owners[1].id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate({
          action: 'set_sufficiency_preferences',
          allowPartialDrafts: 'true',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          'search?q=precio&intent=REQUEST_INFORMATION&allowPartialDrafts=true',
        )
      ).status,
    ).toBe(400);
  });
  it('MAIL-041 distingue una coincidencia documental de una tarifa actual suficiente', async () => {
    const result = await createKnowledgeSources(service, owners[0].id).retrieve(
      {
        question: '¿Cuál es el precio de la consulta?',
        intent: 'REQUEST_INFORMATION',
      },
    );
    expect(result.sufficiency.status).toBe('NEEDS_HUMAN_INPUT');
    expect(result.usedFallback).toBe(true);
    expect(result.matches.map((m) => m.document_id).sort()).toEqual(
      [documentIds[0], documentIds[1]].sort(),
    );
    expect(result.sufficiency.requirements[0].reason).toBe(
      'UNVERIFIED_CURRENCY',
    );
    expect(result.allowPartialDrafts).toBe(false);
    expect(result.sufficiency.missingInformation.join(' ')).toContain('Tarifa');
  });
  it('MAIL-041 una pregunta parcialmente cubierta requiere intervención y solo genera parcial si el usuario lo configura', async () => {
    const sources = createKnowledgeSources(service, owners[0].id);
    const question = '¿Cuál es el plazo? ¿Cuál es el precio?';
    const generation = responseInput();
    generation.conversation.messages[0].text = question;
    const initial = await sources.retrieve({
      question,
      intent: 'REQUEST_INFORMATION',
    });
    expect(initial.sufficiency).toMatchObject({
      status: 'NEEDS_HUMAN_INPUT',
      canPreparePartial: true,
    });
    const api = { generate: vi.fn<TextGenerationClient['generate']>() };
    const withheld = await createResponseGenerator(api).generate({
      ...generation,
      knowledge: initial.matches,
      allowPartialDrafts: initial.allowPartialDrafts,
    });
    expect(withheld).toMatchObject({
      status: 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      needsHumanInput: true,
      modelCalls: 0,
    });
    expect(api.generate).not.toHaveBeenCalled();
    expect(
      (
        await mutate({
          action: 'set_sufficiency_preferences',
          allowPartialDrafts: true,
        })
      ).status,
    ).toBe(200);
    const fresh = await sources.retrieve({
      question,
      intent: 'REQUEST_INFORMATION',
    });
    expect(fresh.allowPartialDrafts).toBe(true);
    const claim = 'El plazo de entrega es de siete días.';
    api.generate
      .mockResolvedValueOnce({
        text: JSON.stringify({
          ...readyResponse(),
          status: 'PARTIAL',
          bodyText: `Hola, gracias por tu consulta. ${claim} Un saludo.`,
          missingInformation: ['Tarifa vigente.'],
          evidence: [
            {
              knowledgeIndex: 0,
              quote: 'Plazo de entrega: siete días.',
              claim,
            },
          ],
        }),
        inputTokens: 10,
        outputTokens: 10,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(supportedResponse()),
        inputTokens: 10,
        outputTokens: 10,
      });
    const partial = await createResponseGenerator(api).generate({
      ...generation,
      knowledge: fresh.matches,
      knowledgePolicy: fresh.policy,
      allowPartialDrafts: fresh.allowPartialDrafts,
    });
    expect(partial).toMatchObject({
      status: 'PARTIAL',
      needsHumanInput: true,
      modelCalls: 2,
    });
    expect(partial.bodyText).toContain(claim);
    expect(partial.bodyText).not.toMatch(/euros|pendiente|\[PRECIO\]/u);
    expect(partial.missingInformation.length).toBeGreaterThan(0);
  });
  it('aísla fuentes, reglas, enlaces y documentos con RLS y validación de propietario', async () => {
    expect((await config(1)).rules).toEqual([]);
    expect((await config(1)).sources.map((s) => s.id)).toEqual([foreignSource]);
    expect(
      (await owners[1].client.from('source_rules').select('*')).data,
    ).toEqual([]);
    expect(
      (await owners[1].client.from('source_rule_sources').select('*')).data,
    ).toEqual([]);
    expect(
      (
        await mutate(
          {
            action: 'save_source',
            id: ids[0],
            title: 'Robo',
            priority: 1,
            enabled: true,
          },
          1,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate({
          action: 'assign_document',
          documentId: documentIds[0],
          sourceId: foreignSource,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate({
          action: 'assign_document',
          documentId: foreignDocument,
          sourceId: ids[0],
        })
      ).status,
    ).toBe(404);
  });
  it('consulta la principal y no incorpora datos de respaldo, excluidos o de otros usuarios', async () => {
    const result = await search();
    expect(result.usedFallback).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      source_id: ids[0],
      source_title: 'Tarifas',
      content: 'Consulta vigente: 125 euros.',
    });
    expect(result.plan.allowEmailHistory).toBe(false);
    expect(result.plan.excludedSourceIds).toEqual([ids[2]]);
  });
  it('utiliza respaldo si la principal no tiene coincidencias', async () => {
    const result = await search('plazo');
    expect(result.usedFallback).toBe(true);
    expect(
      result.matches.map((m: { source_id: string }) => m.source_id),
    ).toEqual([ids[1]]);
    expect(result.matches[0].content).toContain('siete días');
  });
  it('EPIC-06 completa la evidencia principal insuficiente con respaldo y genera una respuesta con ambas procedencias', async () => {
    await createKnowledgeDocuments(service, owners[0].id).setValidity(
      documentIds[0],
      { validFrom: '2000-01-01', validUntil: null },
    );
    const question =
      '¿Cuál es el precio de consulta? ¿Cuál es el plazo de consulta?';
    const result = await search(question);
    expect(result.usedFallback).toBe(true);
    expect(result.sufficiency.status).toBe('EVIDENCE_AVAILABLE');
    expect(
      result.matches.map((m: { document_id: string }) => m.document_id).sort(),
    ).toEqual([documentIds[0], documentIds[1]].sort());
    const priceIndex = result.matches.findIndex(
      (m: { document_id: string }) => m.document_id === documentIds[0],
    );
    const deadlineIndex = result.matches.findIndex(
      (m: { document_id: string }) => m.document_id === documentIds[1],
    );
    const text = {
      generate: vi
        .fn<TextGenerationClient['generate']>()
        .mockResolvedValueOnce({
          text: JSON.stringify({
            ...readyResponse(),
            bodyText:
              'Consulta vigente: 125 euros. Plazo de entrega: siete días.',
            evidence: [
              {
                knowledgeIndex: priceIndex,
                quote: 'Consulta vigente: 125 euros.',
                claim: 'Consulta vigente: 125 euros.',
              },
              {
                knowledgeIndex: deadlineIndex,
                quote: 'Plazo de entrega: siete días.',
                claim: 'Plazo de entrega: siete días.',
              },
            ],
          }),
          inputTokens: 1,
          outputTokens: 1,
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(supportedResponse()),
          inputTokens: 1,
          outputTokens: 1,
        }),
    };
    const input = responseInput();
    input.conversation.messages[0].text = question;
    const generated = await createResponseGenerator(text).generate({
      ...input,
      knowledge: result.matches,
      knowledgePolicy: result.policy,
      allowEmailHistory: result.plan.allowEmailHistory,
    });
    expect(generated).toMatchObject({
      status: 'READY',
      needsHumanInput: false,
      modelCalls: 2,
    });
    expect(
      generated.knowledgeReferences!.map((r) => r.documentId).sort(),
    ).toEqual([documentIds[0], documentIds[1]].sort());
  });
  it.each([false, true])(
    'EPIC-06 aplica el permiso configurado del historial (%s) hasta la generación',
    async (allowEmailHistory) => {
      expect(
        (await mutate({ ...initialRule(), id: ruleId, allowEmailHistory }))
          .status,
      ).toBe(200);
      const result = await search('¿Cuál es el precio de consulta?');
      expect(result.plan.allowEmailHistory).toBe(allowEmailHistory);
      const text = {
        generate: vi
          .fn<TextGenerationClient['generate']>()
          .mockResolvedValueOnce({
            text: JSON.stringify({
              ...readyResponse(),
              bodyText: 'Consulta vigente: 90 euros.',
              evidence: [
                {
                  messageIndex: 0,
                  quote: 'Consulta vigente: 90 euros.',
                  claim: 'Consulta vigente: 90 euros.',
                },
              ],
            }),
            inputTokens: 1,
            outputTokens: 1,
          })
          .mockResolvedValueOnce({
            text: JSON.stringify(supportedResponse()),
            inputTokens: 1,
            outputTokens: 1,
          }),
      };
      const input = responseInput();
      input.conversation.messages = [
        {
          speaker: 'owner',
          text: 'Consulta vigente: 90 euros.',
          isTarget: false,
        },
        {
          speaker: 'participant_1',
          text: '¿Cuál es el precio de consulta?',
          isTarget: true,
        },
      ];
      const generated = await createResponseGenerator(text).generate({
        ...input,
        knowledge: result.matches,
        knowledgePolicy: result.policy,
        allowEmailHistory: result.plan.allowEmailHistory,
      });
      expect(generated.status).toBe(
        allowEmailHistory ? 'READY' : 'INSUFFICIENT_CONTEXT',
      );
      expect(text.generate).toHaveBeenCalledTimes(allowEmailHistory ? 2 : 0);
      if (!allowEmailHistory) expect(generated.bodyText).toBeNull();
    },
  );
  it('MAIL-039 recupera una pregunta natural con límites y referencias completas', async () => {
    const result = await search('Hola, ¿cuál es el plazo de entrega? Gracias.');
    expect(result.usedFallback).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      source_id: ids[1],
      source_priority: 2,
      document_id: documentIds[1],
      version: 1,
      chunk_id: expect.any(String),
      position: 0,
      start_offset: 0,
    });
    expect(result.tokenUpperBound).toBeLessThanOrEqual(6000);
    expect(result.truncated).toBe(false);
    expect(
      result.matches
        .map((match: { content: string }) => match.content)
        .join('\n'),
    ).not.toMatch(/999|125|privada de otro/);
  });
  it('MAIL-039 una autorización explícita no permite recuperar fuentes ajenas ni excluidas', async () => {
    const sources = createKnowledgeSources(service, owners[0].id);
    const result = await sources.retrieve({
      question: 'Consulta',
      intent: 'REQUEST_INFORMATION',
      allowedSourceIds: [foreignSource, ids[2]],
    });
    expect(result.matches).toEqual([]);
    expect(result.plan.reason).toBe('NO_AUTHORIZED_SOURCES');
  });
  it('MAIL-039 entrega al generador los extractos reales y conserva sus identificadores al verificar la respuesta', async () => {
    const result = await createKnowledgeSources(service, owners[0].id).retrieve(
      {
        question: '¿Cuál es el plazo de entrega?',
        intent: 'REQUEST_INFORMATION',
      },
    );
    const claim = 'El plazo de entrega es de siete días.';
    const text = {
      generate: vi
        .fn<TextGenerationClient['generate']>()
        .mockResolvedValueOnce({
          text: JSON.stringify({
            ...readyResponse(),
            bodyText: `Hola, gracias por tu consulta. ${claim} Un saludo.`,
            evidence: [
              {
                knowledgeIndex: 0,
                quote: 'Plazo de entrega: siete días.',
                claim,
              },
            ],
          }),
          inputTokens: 10,
          outputTokens: 10,
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(supportedResponse()),
          inputTokens: 10,
          outputTokens: 10,
        }),
    };
    const response = await createResponseGenerator(text).generate({
      ...responseInput(),
      knowledge: result.matches,
    });
    expect(response.status).toBe('READY');
    expect(response.knowledgeReferences).toMatchObject([
      {
        knowledgeIndex: 0,
        sourceId: ids[1],
        documentId: documentIds[1],
        version: 1,
        chunkId: result.matches[0].chunk_id,
      },
    ]);
    expect(text.generate).toHaveBeenCalledTimes(2);
    for (const [call] of text.generate.mock.calls)
      expect(JSON.parse(call.input).knowledge).toEqual(
        result.matches.map(
          ({ audience_kind: _kind, audience_key: _key, ...fragment }) => {
            void _kind;
            void _key;
            return fragment;
          },
        ),
      );
  });
  it('MAIL-039 elimina copias documentales sin alterar su texto ni perder trazabilidad', async () => {
    const documents = createKnowledgeDocuments(service, owners[0].id);
    const sources = createKnowledgeSources(service, owners[0].id);
    const document = await documents.upload(
      new File(['Consulta vigente: 125 euros.'], 'duplicada.txt', {
        type: 'text/plain',
      }),
    );
    try {
      await sources.mutate({
        action: 'assign_document',
        documentId: document.id,
        sourceId: ids[0],
      });
      const result = await sources.retrieve({
        question: 'Consulta',
        intent: 'REQUEST_INFORMATION',
      });
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].content).toBe('Consulta vigente: 125 euros.');
      expect([document.id, documentIds[0]]).toContain(
        result.matches[0].document_id,
      );
      expect(result.matches[0].chunk_id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await documents.remove(document.id);
    }
  });
  it('MAIL-039 respeta un presupuesto reducido y rechaza límites o parámetros de identidad', async () => {
    const result = await createKnowledgeSources(service, owners[0].id).retrieve(
      {
        question: 'Consulta',
        intent: 'REQUEST_INFORMATION',
        maxContextTokens: 256,
      },
    );
    expect(result.matches).toEqual([]);
    expect(result.tokenUpperBound).toBeLessThanOrEqual(256);
    expect(result.truncated).toBe(true);
    for (const query of [
      'q=consulta&intent=REQUEST_INFORMATION&limit=9',
      'q=consulta&intent=REQUEST_INFORMATION&intent=MEETING',
      `q=consulta&intent=REQUEST_INFORMATION&sourceId=${foreignSource}`,
    ])
      expect((await request(`search?${query}`)).status).toBe(400);
    expect(
      (
        await fetch(
          `${origin}/api/knowledge/search?q=consulta&intent=REQUEST_INFORMATION`,
        )
      ).status,
    ).toBe(401);
  });
  it('MAIL-040 edita vigencia con propietario de sesión e invalida snapshots anteriores sin rejuvenecer contenido', async () => {
    const documents = createKnowledgeDocuments(service, owners[0].id);
    const old = (await documents.list()).find((d) => d.id === documentIds[0])!;
    const snapshot = await config();
    const period = {
      validFrom: new Date().toISOString().slice(0, 10),
      validUntil: null,
    };
    const response = await request(`documents/${documentIds[0]}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(period),
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await documents.reindex(documentIds[0]);
    const saved = (await documents.list()).find(
      (d) => d.id === documentIds[0],
    )!;
    expect(saved.content_updated_at).toBe(old.content_updated_at);
    expect(saved.valid_from).toBe(period.validFrom);
    expect((await config()).revision).not.toBe(snapshot.revision);
    const stale = await service.rpc('search_knowledge_context_chunks', {
      p_user_id: owners[0].id,
      p_query: 'consulta',
      p_source_ids: [ids[0]],
      p_revision: snapshot.revision,
      p_limit: 20,
    });
    expect(stale.error?.message).toBe('SOURCE_CONFIGURATION_CHANGED');
    expect(
      (
        await request(
          `documents/${documentIds[0]}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(period),
          },
          1,
        )
      ).status,
    ).toBe(404);
    for (const body of [
      { ...period, userId: owners[1].id },
      { validFrom: '2026-02-30', validUntil: null },
      { validFrom: '2026-12-01', validUntil: '2026-01-01' },
    ])
      expect(
        (
          await request(`documents/${documentIds[0]}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
  });
  it('MAIL-040 descarta la tarifa caducada e identifica el respaldo con vigencia declarada', async () => {
    const documents = createKnowledgeDocuments(service, owners[0].id);
    await documents.setValidity(documentIds[0], {
      validFrom: null,
      validUntil: '2000-01-01',
    });
    await documents.setValidity(documentIds[1], {
      validFrom: new Date().toISOString().slice(0, 10),
      validUntil: null,
    });
    const result = await search();
    expect(result.usedFallback).toBe(true);
    expect(
      result.matches.map((m: { document_id: string }) => m.document_id),
    ).toEqual([documentIds[1]]);
    expect(result.review.omitted).toMatchObject([{ reason: 'EXPIRED' }]);
    expect(result.review.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_id: documentIds[0],
          currency: 'EXPIRED',
        }),
        expect.objectContaining({
          document_id: documentIds[1],
          currency: 'CURRENT',
        }),
      ]),
    );
    expect(result.policy.action).toBe('ALLOW_DRAFT');
  });
  it('MAIL-040 comunica contradicciones aunque solo se entregue un fragmento al generador', async () => {
    const documents = createKnowledgeDocuments(service, owners[0].id),
      sources = createKnowledgeSources(service, owners[0].id);
    const document = await documents.upload(
      new File(['Consulta vigente: 150 euros.'], 'tarifa-contradictoria.txt', {
        type: 'text/plain',
      }),
    );
    try {
      await sources.mutate({
        action: 'assign_document',
        documentId: document.id,
        sourceId: ids[0],
      });
      const response = await request(
        'search?q=consulta&intent=REQUEST_INFORMATION&limit=1',
      );
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.matches).toHaveLength(1);
      expect(result.review.conflicts[0].resolution).toBe('UNRESOLVED');
      expect(result.policy).toEqual({
        action: 'REVIEW_REQUIRED',
        reasons: ['KNOWLEDGE_CONFLICT'],
      });
      const generate = vi.fn<TextGenerationClient['generate']>();
      const generated = await createResponseGenerator({ generate }).generate({
        ...responseInput(),
        knowledge: result.matches,
        knowledgePolicy: result.policy,
      });
      expect(generated).toMatchObject({
        status: 'INSUFFICIENT_CONTEXT',
        bodyText: null,
        modelCalls: 0,
      });
      expect(generate).not.toHaveBeenCalled();
    } finally {
      await documents.remove(document.id);
    }
  });
  it('MAIL-040 resuelve el conflicto por vigencia explícita y conserva ambas procedencias para inspección', async () => {
    const documents = createKnowledgeDocuments(service, owners[0].id),
      sources = createKnowledgeSources(service, owners[0].id);
    const document = await documents.upload(
      new File(['Consulta vigente: 150 euros.'], 'tarifa-vigente.txt', {
        type: 'text/plain',
      }),
    );
    try {
      await sources.mutate({
        action: 'assign_document',
        documentId: document.id,
        sourceId: ids[0],
      });
      await documents.setValidity(document.id, {
        validFrom: new Date().toISOString().slice(0, 10),
        validUntil: null,
      });
      const result = await search();
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].document_id).toBe(document.id);
      expect(result.review.conflicts[0].resolution).toBe('PREFER_CURRENT');
      expect(
        result.review.references
          .map((r: { document_id: string }) => r.document_id)
          .sort(),
      ).toEqual([document.id, documentIds[0]].sort());
      expect(result.policy.action).toBe('ALLOW_DRAFT');
    } finally {
      await documents.remove(document.id);
    }
  });
  it('MAIL-040 no utiliza documentos futuros como si fueran vigentes', async () => {
    const documents = createKnowledgeDocuments(service, owners[0].id);
    await documents.setValidity(documentIds[0], {
      validFrom: '9999-01-01',
      validUntil: null,
    });
    await documents.setValidity(documentIds[1], {
      validFrom: '9999-01-01',
      validUntil: null,
    });
    const result = await search();
    expect(result.matches).toEqual([]);
    expect(
      result.review.omitted.every(
        (r: { reason: string }) => r.reason === 'NOT_YET_VALID',
      ),
    ).toBe(true);
    expect(result.policy).toEqual({
      action: 'REVIEW_REQUIRED',
      reasons: ['KNOWLEDGE_NOT_CURRENT'],
    });
  });
  it('las exclusiones y la prohibición del historial prevalecen al combinar reglas', async () => {
    const response = await mutate({
      ...initialRule(),
      title: 'Regla prioritaria',
      priority: 0,
      allowEmailHistory: true,
      primarySourceIds: [ids[2], ids[1]],
      fallbackSourceIds: [],
      excludedSourceIds: [ids[0]],
    });
    expect(response.status).toBe(200);
    const result = await search();
    expect(
      result.matches.map((m: { source_id: string }) => m.source_id),
    ).toEqual([ids[1]]);
    expect(result.plan.allowEmailHistory).toBe(false);
  });
  it('la desactivación de fuentes no amplía la búsqueda a documentos no autorizados', async () => {
    expect(
      (
        await mutate({
          action: 'save_source',
          id: ids[0],
          title: 'Tarifas',
          priority: 1,
          enabled: false,
        })
      ).status,
    ).toBe(200);
    expect((await search()).usedFallback).toBe(true);
    await mutate({
      action: 'save_source',
      id: ids[1],
      title: 'Respaldo',
      priority: 2,
      enabled: false,
    });
    expect(await search()).toMatchObject({
      matches: [],
      plan: { reason: 'NO_AUTHORIZED_SOURCES' },
    });
  });
  it('sin intención o tema aplicable no consulta todo el índice', async () => {
    expect(await search('consulta', 'MEETING')).toMatchObject({
      matches: [],
      plan: { reason: 'NO_MATCHING_RULE', allowEmailHistory: false },
    });
    expect(await search('una pregunta distinta')).toMatchObject({
      matches: [],
      plan: { reason: 'NO_MATCHING_RULE' },
    });
  });
  it('rechaza revisiones obsoletas si cambian las restricciones durante la consulta', async () => {
    const old = await config();
    await mutate({ ...initialRule(), id: ruleId, allowEmailHistory: true });
    const stale = await service.rpc('search_knowledge_source_chunks', {
      p_user_id: owners[0].id,
      p_query: 'consulta',
      p_source_ids: [ids[0]],
      p_revision: old.revision,
      p_limit: 10,
    });
    expect(stale.error?.message).toBe('SOURCE_CONFIGURATION_CHANGED');
    expect((await search()).plan.allowEmailHistory).toBe(true);
  });
  it('un guardado inválido conserva las reglas y sus asociaciones anteriores', async () => {
    const old = await config();
    expect(
      (
        await mutate({
          ...initialRule(),
          id: ruleId,
          primarySourceIds: [foreignSource],
        })
      ).status,
    ).toBe(404);
    expect((await config()).revision).toBe(old.revision);
    expect(
      (
        await mutate({
          ...initialRule(),
          id: ruleId,
          fallbackSourceIds: [ids[0]],
        })
      ).status,
    ).toBe(400);
    expect((await config()).revision).toBe(old.revision);
  });
  it('elimina reglas y fuentes sin borrar documentos asociados de forma implícita', async () => {
    const created = await mutate({
      action: 'save_source',
      title: 'Temporal',
      priority: 100,
      enabled: true,
    });
    const id = (await created.json()).id;
    await mutate({
      action: 'assign_document',
      documentId: documentIds[0],
      sourceId: id,
    });
    expect((await mutate({ action: 'delete_source', id })).status).toBe(409);
    expect(
      (
        await mutate({
          action: 'assign_document',
          documentId: documentIds[0],
          sourceId: null,
        })
      ).status,
    ).toBe(200);
    expect((await mutate({ action: 'delete_source', id })).status).toBe(200);
    expect((await mutate({ action: 'delete_rule', id: ruleId })).status).toBe(
      200,
    );
    expect((await config()).rules).toEqual([]);
    expect(
      (
        await service
          .from('source_documents')
          .select('id')
          .eq('id', documentIds[0])
      ).data,
    ).toHaveLength(1);
  });
});
