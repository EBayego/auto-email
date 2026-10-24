import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/db/database.types';
import { createAuthClient } from '@/modules/auth/client';
import { createKnowledgeDocuments } from '@/db/knowledge-documents';
import { createKnowledgeSources } from '@/db/knowledge-sources';
import {
  knowledgeTokenUpperBound,
  type KnowledgeRetrievalResult,
} from '@/modules/knowledge/retriever';
import { knowledgeReferenceId } from '@/modules/knowledge/provenance';
import { createResponseGenerator } from '@/modules/response/generator';
import { createReplyOrchestrator } from '@/modules/response/orchestrator';
import { createReplyKnowledgeResolver } from '@/modules/response/knowledge-context';
import { createEmailFixtures } from './fixtures/emails';
import {
  writingProfileFixture,
  writingProfileRow,
} from './fixtures/writing-profile';
import type { TextGenerationClient } from '@/providers/contracts';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from './fixtures/responses';
import {
  corpusCases,
  corpusDocuments,
  corpusFile,
  corpusRules,
  corpusSources,
  corpusVersion,
  type CorpusCase,
  type CorpusDocument,
  type CorpusSource,
} from './fixtures/knowledge-corpus';
import {
  scoreRetrieval,
  summarizeRetrieval,
  type RetrievalScore,
} from './knowledge-evaluation/metrics';

const origin = process.env.AUTO_EMAIL_TEST_APP_URL!;
const service = createClient<Database>(
  process.env.AUTO_EMAIL_TEST_URL!,
  process.env.AUTO_EMAIL_TEST_SECRET_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const owners: {
  id: string;
  jar: Map<string, string>;
  client: ReturnType<typeof createAuthClient>;
}[] = [];
const sources = new Map<CorpusSource, string>();
const documents = new Map<CorpusDocument, string>();
const oldChunkIds: string[] = [];
let foreignSource: string, foreignDocument: string;
const scores = new Map<string, RetrievalScore & { passed: boolean }>();
const repository = () => createKnowledgeSources(service, owners[0].id);
const documentRepository = () =>
  createKnowledgeDocuments(service, owners[0].id);
function request(path: string, init: RequestInit = {}, owner = 0) {
  return fetch(`${origin}/api/knowledge/${path}`, {
    ...init,
    redirect: 'manual',
    headers: {
      origin,
      cookie: [...owners[owner].jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...init.headers,
    },
  });
}
async function retrieve(
  test: Pick<CorpusCase, 'question' | 'intent'>,
  limit = 6,
): Promise<KnowledgeRetrievalResult> {
  const response = await request(
    `search?${new URLSearchParams({ q: test.question, intent: test.intent ?? 'REQUEST_INFORMATION', limit: String(limit) })}`,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return response.json();
}
async function checkTraceability(result: KnowledgeRetrievalResult) {
  expect(result.matches.length).toBeLessThanOrEqual(6);
  expect(result.tokenUpperBound).toBe(knowledgeTokenUpperBound(result.matches));
  expect(result.tokenUpperBound).toBeLessThanOrEqual(6000);
  expect(new Set(result.matches.map((m) => m.chunk_id)).size).toBe(
    result.matches.length,
  );
  for (const match of result.matches) {
    expect(result.review.references).toContainEqual(
      expect.objectContaining({
        reference_id: knowledgeReferenceId(match),
        source_id: match.source_id,
        document_id: match.document_id,
        version: match.version,
        chunk_id: match.chunk_id,
        start_offset: match.start_offset,
        end_offset: match.end_offset,
      }),
    );
    expect(result.review.omitted.map((o) => o.reference_id)).not.toContain(
      knowledgeReferenceId(match),
    );
  }
  if (result.matches.length) {
    const stored = await service
      .from('knowledge_chunks')
      .select(
        'id,document_id,version,content,section,start_offset,end_offset,page_start,page_end',
      )
      .in(
        'id',
        result.matches.map((m) => m.chunk_id),
      )
      .eq('user_id', owners[0].id);
    expect(stored.error).toBeNull();
    for (const match of result.matches)
      expect(stored.data).toContainEqual({
        id: match.chunk_id,
        document_id: match.document_id,
        version: match.version,
        content: match.content,
        section: match.section,
        start_offset: match.start_offset,
        end_offset: match.end_offset,
        page_start: match.page_start,
        page_end: match.page_end,
      });
  }
  // Check all inspected references as well as the final, budgeted context.
  for (const reference of result.review.references) {
    expect([...documents.values()]).toContain(reference.document_id);
    expect(reference.document_id).not.toBe(documents.get('unassigned'));
    expect(reference.document_id).not.toBe(documents.get('forbidden'));
    expect(reference.source_id).not.toBe(foreignSource);
    const definition = corpusDocuments.find(
      (d) => documents.get(d.key) === reference.document_id,
    )!;
    expect(reference).toMatchObject({
      source_id: sources.get(definition.source!),
      version: definition.version,
      valid_from: definition.validity.validFrom,
      valid_until: definition.validity.validUntil,
    });
  }
  expect(JSON.stringify(result)).not.toMatch(
    /CANARIOEXCLUIDO|CANARIOSINASIGNAR|CANARIOAJENO/,
  );
}

describe('MAIL-042 evaluación del Knowledge Engine con corpus controlado', () => {
  beforeAll(async () => {
    // These accounts and all uploaded objects are disposable and local-only.
    for (let i = 0; i < 2; i++) {
      const email = `knowledge-evaluation-${crypto.randomUUID()}@example.invalid`,
        password = `Evaluation-${crypto.randomUUID()}!`;
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
    for (const [key, priority] of Object.entries(corpusSources)) {
      const saved = await repository().mutate({
        action: 'save_source',
        title: key,
        priority,
        enabled: true,
      });
      sources.set(key as CorpusSource, saved.id);
    }
    for (const definition of corpusDocuments) {
      const doc = await documentRepository().upload(
        await corpusFile(definition, true),
      );
      documents.set(definition.key, doc.id);
      expect(doc.status).toBe('READY');
      if (definition.version === 2) {
        oldChunkIds.push(
          ...(await documentRepository().chunks(doc.id)).chunks.map(
            (c) => c.id,
          ),
        );
        const file = await corpusFile(definition),
          bytes = Buffer.from(await file.arrayBuffer());
        expect(
          (
            await service.storage
              .from('knowledge-documents')
              .upload(`${owners[0].id}/${doc.id}`, bytes, {
                contentType: file.type,
                upsert: true,
              })
          ).error,
        ).toBeNull();
        expect(
          (
            await service
              .from('source_documents')
              .update({
                version: 2,
                byte_size: bytes.length,
                text_length: Array.from(definition.text).length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
              })
              .eq('id', doc.id)
              .eq('user_id', owners[0].id)
          ).error,
        ).toBeNull();
        expect(
          (
            await service
              .from('source_document_texts')
              .update({ text_content: definition.text })
              .eq('document_id', doc.id)
              .eq('user_id', owners[0].id)
          ).error,
        ).toBeNull();
        await documentRepository().reindex(doc.id);
      }
      if (definition.source)
        await repository().mutate({
          action: 'assign_document',
          documentId: doc.id,
          sourceId: sources.get(definition.source)!,
        });
      await documentRepository().setValidity(doc.id, definition.validity);
    }
    for (const rule of corpusRules) {
      await repository().mutate({
        action: 'save_rule',
        title: rule.title,
        intent: 'REQUEST_INFORMATION',
        terms: rule.terms,
        priority: 100,
        enabled: true,
        allowEmailHistory: false,
        primarySourceIds: rule.primary.map((s) => sources.get(s)!),
        fallbackSourceIds: (rule.fallback ?? []).map((s) => sources.get(s)!),
        excludedSourceIds: [sources.get('forbidden')!],
      });
    }
    // An additional matching rule explicitly permits the forbidden source;
    // another rule's exclusion must still win, even over priority zero.
    await repository().mutate({
      action: 'save_rule',
      title: 'Permiso subordinado a exclusiones',
      intent: 'REQUEST_INFORMATION',
      terms: ['atlas', 'nebula'],
      priority: 0,
      enabled: true,
      allowEmailHistory: true,
      primarySourceIds: [sources.get('forbidden')!],
      fallbackSourceIds: [],
      excludedSourceIds: [],
    });
    const other = createKnowledgeSources(service, owners[1].id);
    foreignSource = (
      await other.mutate({
        action: 'save_source',
        title: 'Otra organización',
        priority: 0,
        enabled: true,
      })
    ).id;
    foreignDocument = (
      await createKnowledgeDocuments(service, owners[1].id).upload(
        new File(
          ['Precio de Atlas: 0 euros. Código de Halley: CANARIOAJENO.'],
          'other-owner.txt',
          { type: 'text/plain' },
        ),
      )
    ).id;
    await other.mutate({
      action: 'assign_document',
      documentId: foreignDocument,
      sourceId: foreignSource,
    });
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      const cases = [...scores.values()];
      await mkdir('coverage/knowledge', { recursive: true });
      await writeFile(
        'coverage/knowledge/report.json',
        JSON.stringify(
          {
            corpusVersion,
            maxFragments: 6,
            completed: cases.length === corpusCases.length,
            corpusPassed:
              cases.length === corpusCases.length &&
              cases.every((c) => c.passed),
            metrics: summarizeRetrieval(cases),
            cases,
          },
          null,
          2,
        ) + '\n',
      );
    } catch (error) {
      errors.push(error);
    }
    for (const owner of owners) {
      try {
        const docs = await service
          .from('source_documents')
          .select('id')
          .eq('user_id', owner.id);
        if (docs.error) errors.push(docs.error);
        if (docs.data?.length) {
          const removed = await service.storage
            .from('knowledge-documents')
            .remove(docs.data.map((d) => `${owner.id}/${d.id}`));
          if (removed.error) errors.push(removed.error);
        }
        // Remove referencing rows before deleting sources or the Auth owner.
        for (const table of [
          'source_rules',
          'source_documents',
          'knowledge_sources',
        ] as const) {
          const deleted = await service
            .from(table)
            .delete()
            .eq('user_id', owner.id);
          if (deleted.error) errors.push(deleted.error);
        }
        const removed = await service.auth.admin.deleteUser(owner.id);
        if (removed.error) errors.push(removed.error);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        'No se pudo guardar la evaluación o limpiar todo el corpus local.',
      );
  });

  it.each(corpusCases)('$id: $question', async (test) => {
    const result = await retrieve(test);
    const allowed = new Set(
      [...result.plan.primarySources, ...result.plan.fallbackSources].map(
        (s) => s.id,
      ),
    );
    const score = {
      ...scoreRetrieval({
        id: test.id,
        category: test.category,
        expected: test.evidence.map((e) => ({
          documentId: documents.get(e.document)!,
          version: e.version,
          quote: e.quote,
        })),
        retrieved: result.matches.map((m) => ({
          documentId: m.document_id,
          version: m.version,
          content: m.content,
          authorized:
            allowed.has(m.source_id) &&
            [...documents.values()].includes(m.document_id) &&
            m.source_id !== sources.get('forbidden') &&
            m.document_id !== documents.get('unassigned'),
        })),
        expectedDisposition: test.disposition,
        actualDisposition:
          result.policy.action === 'ALLOW_DRAFT' &&
          result.sufficiency.status === 'EVIDENCE_AVAILABLE'
            ? 'ANSWERABLE'
            : 'HUMAN_INPUT',
      }),
      passed: false,
    };
    scores.set(test.id, score);
    await checkTraceability(result);
    expect(result.matches.map((m) => m.document_id).sort()).toEqual(
      test.returnedDocuments.map((d) => documents.get(d)).sort(),
    );
    expect(result.usedFallback).toBe(test.fallback);
    expect(result.policy.action).toBe(test.policy);
    expect(result.plan.allowEmailHistory).toBe(false);
    if (test.id === 'atlas-current-version' || test.id === 'forbidden-source') {
      expect(result.plan.excludedSourceIds).toContain(sources.get('forbidden'));
      expect(allowed.has(sources.get('forbidden')!)).toBe(false);
    }
    expect(score.dispositionCorrect).toBe(true);
    expect(score.unauthorizedFragments).toBe(0);
    if (test.evidence.length) {
      expect(score).toMatchObject({
        hitAt1: 1,
        hitAtK: 1,
        reciprocalRank: 1,
        recall: 1,
        precision: 1,
      });
      for (const expected of test.evidence)
        expect(result.matches).toContainEqual(
          expect.objectContaining({
            document_id: documents.get(expected.document),
            version: expected.version,
            content: expect.stringContaining(expected.quote),
          }),
        );
    }
    if (test.resolution) {
      expect(result.review.conflicts.length).toBeGreaterThan(0);
      expect(
        result.review.conflicts.every((c) => c.resolution === test.resolution),
      ).toBe(true);
    }
    if (test.id === 'orion-source-authority')
      expect(result.plan.primarySources.map((s) => s.id)).toEqual([
        sources.get('authority'),
        sources.get('advisory'),
      ]);
    if (test.missingKind)
      expect(result.sufficiency.requirements).toContainEqual(
        expect.objectContaining({
          kind: test.missingKind,
          status: 'MISSING',
        }),
      );
    if (test.id === 'atlas-current-version')
      expect(result.review.omitted).toContainEqual(
        expect.objectContaining({
          reference_id: expect.stringContaining(
            `${documents.get('atlas-archive')}:v1:`,
          ),
          reason: 'EXPIRED',
        }),
      );
    if (test.id === 'partial-known-price-missing-deadline') {
      expect(result.sufficiency.canPreparePartial).toBe(true);
      expect(result.allowPartialDrafts).toBe(false);
    }
    score.passed = true;
  });

  it('impone los mínimos del corpus para que una regresión no pase silenciosamente', () => {
    expect([...scores.keys()].sort()).toEqual(
      corpusCases.map((c) => c.id).sort(),
    );
    const metrics = summarizeRetrieval([...scores.values()]);
    expect(metrics).toMatchObject({
      queries: 15,
      evidenceQueries: 9,
      abstentionQueries: 8,
      hitAt1: 1,
      hitAtK: 1,
      meanReciprocalRank: 1,
      meanRecall: 1,
      meanPrecision: 1,
      dispositionAccuracy: 1,
      abstentionAccuracy: 1,
      unauthorizedFragments: 0,
    });
    expect(metrics.overallPrecision).toBe(1);
    expect([...scores.values()].every((c) => c.passed)).toBe(true);
    console.info('Knowledge Engine:', JSON.stringify(metrics));
  });

  it('indexa formatos reales, fragmenta el manual y elimina la revisión sustituida', async () => {
    expect(oldChunkIds.length).toBeGreaterThan(0);
    const manual = await documentRepository().chunks(
      documents.get('support-manual')!,
      0,
      50,
    );
    expect(manual.total).toBeGreaterThan(2);
    const normalized = await service
      .from('source_document_texts')
      .select('document_id,normalized_text')
      .eq('user_id', owners[0].id);
    expect(normalized.error).toBeNull();
    for (const definition of corpusDocuments) {
      const id = documents.get(definition.key)!;
      const index = await documentRepository().chunks(id, 0, 50);
      const text = normalized.data!.find(
        (d) => d.document_id === id,
      )!.normalized_text!;
      expect(index.chunks.length).toBeGreaterThan(0);
      for (const chunk of index.chunks) {
        expect(chunk.version).toBe(definition.version);
        expect(
          Array.from(text).slice(chunk.start_offset, chunk.end_offset).join(''),
        ).toBe(chunk.content);
        if (definition.format === 'pdf') expect(chunk.page_start).toBe(1);
        expect(oldChunkIds).not.toContain(chunk.id);
      }
    }
    expect(await documentRepository().search('AntiguaAtlas')).toEqual([]);
    expect(
      (
        await service
          .from('knowledge_chunks')
          .select('id')
          .in('id', oldChunkIds)
      ).data,
    ).toEqual([]);
    for (const [key, marker] of [
      ['unassigned', 'CANARIOSINASIGNAR'],
      ['forbidden', 'CANARIOEXCLUIDO'],
    ] as const)
      expect(await documentRepository().search(marker)).toContainEqual(
        expect.objectContaining({ document_id: documents.get(key) }),
      );
  });

  it('preserva el aislamiento en HTTP, RLS, Storage y el RPC con identidad manipulada', async () => {
    for (const [i, owner] of owners.entries()) {
      const foreignId =
        i === 0 ? foreignDocument : documents.get('atlas-current')!;
      const rows = await owner.client
        .from('knowledge_chunks')
        .select('document_id');
      expect(rows.error).toBeNull();
      expect(rows.data!.length).toBeGreaterThan(0);
      expect(rows.data!.some((r) => r.document_id === foreignId)).toBe(false);
      expect((await request(`documents/${foreignId}`, {}, i)).status).toBe(404);
      expect(
        (
          await owner.client.storage
            .from('knowledge-documents')
            .download(`${owners[1 - i].id}/${foreignId}`)
        ).error,
      ).not.toBeNull();
      const rpc = await owner.client.rpc('search_knowledge_context_chunks', {
        p_user_id: owners[1 - i].id,
        p_source_ids: [foreignSource],
        p_query: 'Atlas',
        p_revision: 'forged',
      });
      expect(rpc.error?.code).toBe('42501');
    }
    const snapshot = await repository().list();
    const forged = await service.rpc('search_knowledge_context_chunks', {
      p_user_id: owners[0].id,
      p_source_ids: [foreignSource],
      p_query: 'Halley OR Atlas',
      p_revision: snapshot.revision,
    });
    expect(forged.error).toBeNull();
    expect(forged.data).toEqual([]);
    const narrowed = await repository().retrieve({
      question: '¿Cuál es el precio de Atlas?',
      intent: 'REQUEST_INFORMATION',
      allowedSourceIds: [foreignSource, sources.get('forbidden')!],
    });
    expect(narrowed.matches).toEqual([]);
    expect(narrowed.plan.reason).toBe('NO_AUTHORIZED_SOURCES');
  });

  it('una fuente desactivada no participa en la recuperación', async () => {
    const id = sources.get('manual')!;
    try {
      await repository().mutate({
        action: 'save_source',
        id,
        title: 'manual',
        priority: corpusSources.manual,
        enabled: false,
      });
      const result = await retrieve({
        question: '¿Cuál es el horario de soporte?',
      });
      expect(result.matches).toEqual([]);
      expect(result.plan.reason).toBe('NO_AUTHORIZED_SOURCES');
      expect(result.sufficiency.status).toBe('NEEDS_HUMAN_INPUT');
    } finally {
      await repository().mutate({
        action: 'save_source',
        id,
        title: 'manual',
        priority: corpusSources.manual,
        enabled: true,
      });
    }
  });

  it('conserva la advertencia de conflicto fuera del límite de fragmentos y se abstiene con poco presupuesto', async () => {
    const conflict = await retrieve(
      { question: '¿Cuál es el precio de Vega?' },
      1,
    );
    expect(conflict.matches).toHaveLength(1);
    expect(conflict.review.references).toHaveLength(2);
    expect(conflict.policy.action).toBe('REVIEW_REQUIRED');
    const budget = await repository().retrieve({
      question: '¿Cuál es el precio de Atlas?',
      intent: 'REQUEST_INFORMATION',
      maxContextTokens: 256,
    });
    expect(budget).toMatchObject({
      matches: [],
      truncated: true,
      sufficiency: { status: 'NEEDS_HUMAN_INPUT' },
    });
    expect(budget.tokenUpperBound).toBeLessThanOrEqual(256);
  });

  it.each(corpusCases.filter((c) => c.disposition === 'HUMAN_INPUT'))(
    'se abstiene sin invocar el modelo ante $id',
    async (test) => {
      const result = await retrieve(test);
      const generate = vi.fn<TextGenerationClient['generate']>();
      const input = responseInput();
      input.conversation.messages[0].text = test.question;
      const generated = await createResponseGenerator({ generate }).generate({
        ...input,
        knowledge: result.matches,
        knowledgePolicy: result.policy,
        allowPartialDrafts: result.allowPartialDrafts,
      });
      expect(generated).toMatchObject({
        status: 'INSUFFICIENT_CONTEXT',
        bodyText: null,
        needsHumanInput: true,
        modelCalls: 0,
      });
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it('MAIL-044 orquesta una conversación actual con conocimiento autorizado de Supabase', async () => {
    const question = 'Hola, ¿cuál es el precio de Atlas? Gracias.';
    const thread = createEmailFixtures(question).pending;
    const sourcesRepository = repository();
    const generate = vi.fn<TextGenerationClient['generate']>(async (input) => {
      const verification =
        input.jsonSchema?.name === 'response_verification_v1';
      const payload = JSON.parse(input.input);
      const index = payload.knowledge.findIndex(
        (f: { document_id: string }) =>
          f.document_id === documents.get('atlas-current'),
      );
      expect(index).toBeGreaterThanOrEqual(0);
      const quote = payload.knowledge[index].content;
      return {
        text: JSON.stringify(
          verification
            ? supportedResponse()
            : {
                ...readyResponse(),
                bodyText: `Hola. ${quote} Un saludo.`,
                evidence: [{ knowledgeIndex: index, quote, claim: quote }],
              },
        ),
        inputTokens: 10,
        outputTokens: 5,
      };
    });
    const orchestrator = createReplyOrchestrator({
      gmail: { getThread: async () => thread },
      generator: createResponseGenerator({ generate }),
      styleExamples: { retrieve: async () => [] },
      retrieveKnowledge: createReplyKnowledgeResolver({
        configuration: sourcesRepository.list,
        classify: async () => ({ intent: 'REQUEST_INFORMATION' }),
        retriever: sourcesRepository,
      }),
    });
    const result = await orchestrator.generate({
      selection: {
        accountId: 'synthetic-account44',
        mailboxAddress: 'owner@example.invalid',
        threadId: thread.id,
        resolveStyle: async () => ({
          revision: writingProfileRow().revision,
          profile: writingProfileFixture(),
        }),
      },
    });
    expect(result.reply).toMatchObject({
      status: 'READY',
      email: { bodyText: expect.stringContaining('125 euros') },
      sourcesUsed: [
        {
          kind: 'KNOWLEDGE_FRAGMENT',
          sourceId: sources.get('current'),
          documentId: documents.get('atlas-current'),
          version: 2,
        },
      ],
    });
    expect(result.generation).toMatchObject({
      knowledgeFragmentsUsed: 1,
      modelCalls: 2,
    });
    expect(JSON.stringify(result.generation)).not.toContain('125 euros');
  });

  it('entrega al generador la cita literal y la misma procedencia en generación y verificación', async () => {
    const question = '¿Cuál es el precio de Atlas?';
    const result = await retrieve({ question });
    const generate = vi
      .fn<TextGenerationClient['generate']>()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          ...readyResponse(),
          bodyText: 'El precio de Atlas es de 125 euros.',
          evidence: [
            {
              knowledgeIndex: 0,
              quote: 'Precio de Atlas: 125 euros.',
              claim: 'El precio de Atlas es de 125 euros.',
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
      });
    const input = responseInput();
    input.conversation.messages[0].text = question;
    const generated = await createResponseGenerator({ generate }).generate({
      ...input,
      knowledge: result.matches,
      knowledgePolicy: result.policy,
    });
    expect(generated.status).toBe('READY');
    expect(generated.knowledgeReferences).toMatchObject([
      {
        reference_id: knowledgeReferenceId(result.matches[0]),
        documentId: documents.get('atlas-current'),
        version: 2,
        chunkId: result.matches[0].chunk_id,
        currency: 'CURRENT',
      },
    ]);
    expect(generate).toHaveBeenCalledTimes(2);
    for (const [call] of generate.mock.calls)
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
});
