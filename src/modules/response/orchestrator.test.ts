import { describe, expect, it, vi } from 'vitest';
import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import { createKnowledgeRetriever } from '@/modules/knowledge/retriever';
import { createEmailFixtures } from '../../../tests/fixtures/emails';
import {
  knowledgeCandidate,
  knowledgeConfiguration,
} from '../../../tests/fixtures/knowledge';
import {
  writingProfileFixture,
  writingProfileRow,
} from '../../../tests/fixtures/writing-profile';
import {
  readyResponse,
  supportedResponse,
} from '../../../tests/fixtures/responses';
import { createReplyKnowledgeResolver } from './knowledge-context';
import { createResponseGenerator } from './generator';
import {
  createReplyOrchestrator,
  type ReplyOrchestrationInput,
} from './orchestrator';

function setup(name: keyof ReturnType<typeof createEmailFixtures> = 'pending') {
  const stages: string[] = [];
  const thread = createEmailFixtures(
    'Hola, ¿cuál es el plazo de entrega? Gracias.',
  )[name];
  const getThread = vi.fn<GmailClient['getThread']>(async () => {
    stages.push('conversation');
    return thread;
  });
  const examples = [{ text: 'Hola, muchas gracias. Un saludo.' }];
  const styleExamples = {
    retrieve: vi.fn(async () => {
      stages.push('examples');
      return examples;
    }),
  };
  const text = {
    generate: vi.fn<TextGenerationClient['generate']>(async (input) => {
      const verify = input.jsonSchema?.name === 'response_verification_v1';
      stages.push(verify ? 'verification' : 'generation');
      const knowledge = JSON.parse(input.input).knowledge;
      const claim = knowledge[0].content;
      return {
        text: JSON.stringify(
          verify
            ? supportedResponse()
            : {
                ...readyResponse(),
                bodyText: `Hola. ${claim} Un saludo.`,
                evidence: [{ knowledgeIndex: 0, quote: claim, claim }],
              },
        ),
        inputTokens: 10,
        outputTokens: 5,
      };
    }),
  };
  const configuration = vi.fn(async () => knowledgeConfiguration());
  const classify = vi.fn(async () => {
    stages.push('classification');
    return { intent: 'REQUEST_INFORMATION' as const };
  });
  const search = vi.fn(async () => {
    stages.push('retrieval');
    return [knowledgeCandidate()];
  });
  const retrieveKnowledge = createReplyKnowledgeResolver({
    configuration,
    classify,
    retriever: createKnowledgeRetriever({
      configuration,
      search,
      assertRevision: vi.fn(),
    }),
  });
  const deps = {
    gmail: { getThread },
    styleExamples,
    generator: createResponseGenerator(text),
    retrieveKnowledge,
  };
  const request: ReplyOrchestrationInput = {
    selection: {
      accountId: 'account44',
      mailboxAddress: 'owner@example.invalid',
      threadId: thread.id,
      resolveStyle: vi.fn(async () => {
        stages.push('profile');
        return {
          revision: writingProfileRow().revision,
          profile: writingProfileFixture(),
          scopeKind: 'RECIPIENT' as const,
        };
      }),
      resolvePreferences: vi.fn(async () => ({
        preferences: [],
        revisions: [],
      })),
    },
  };
  return {
    deps,
    text,
    request,
    stages,
    examples,
    classify,
    search,
    getThread,
    configuration,
    orchestrator: createReplyOrchestrator(deps),
  };
}

describe('MAIL-044 ReplyOrchestrator', () => {
  it('recupera perfil, clasifica, obtiene evidencia y devuelve el contrato estructurado de MAIL-043', async () => {
    const f = setup();
    const result = await f.orchestrator.generate(f.request);
    expect(f.stages).toEqual([
      'conversation',
      'profile',
      'examples',
      'classification',
      'retrieval',
      'generation',
      'verification',
    ]);
    expect(f.request.selection.resolveStyle).toHaveBeenCalledWith(
      'contact@example.invalid',
    );
    expect(result.selection.warnings).toEqual([]);
    expect(result.reply).toMatchObject({
      status: 'READY',
      knowledgeRevision: 'revision-39',
      email: { bodyText: expect.stringContaining('siete días') },
      evaluation: { needsHumanReview: true },
      sourcesUsed: [{ kind: 'KNOWLEDGE_FRAGMENT' }],
    });
    expect(result.generation).toMatchObject({
      examplesUsed: 1,
      knowledgeFragmentsUsed: 1,
      modelCalls: 2,
    });
    expect(JSON.stringify(result.generation)).not.toContain('siete días');
    expect(f.examples).toEqual([]);
  });

  it.each(['answered', 'manualDraft', 'notification'] as const)(
    'detiene etapas posteriores para %s',
    async (name) => {
      const f = setup(name);
      const result = await f.orchestrator.generate(f.request);
      expect(result.reply).toBeNull();
      expect(result.generation).toBeNull();
      expect(f.stages).toEqual(['conversation']);
    },
  );

  it('respeta el veto previo a generar antes de consultar ejemplos y fuentes', async () => {
    const f = setup();
    const result = await f.orchestrator.generate({
      ...f.request,
      shouldGenerate: async () => false,
    });
    expect(result.reply).toBeNull();
    expect(f.classify).not.toHaveBeenCalled();
    expect(f.deps.styleExamples.retrieve).not.toHaveBeenCalled();
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(f.classify).not.toHaveBeenCalled();
  });

  it.each(['classification', 'retrieval', 'configuration'] as const)(
    'un fallo de %s impide llamar al modelo y entregar respuesta',
    async (stage) => {
      const f = setup();
      if (stage === 'classification')
        f.classify.mockRejectedValue(new Error('CLASSIFICATION_FAILED'));
      if (stage === 'retrieval')
        f.search.mockRejectedValue(new Error('RETRIEVAL_FAILED'));
      if (stage === 'configuration')
        f.configuration.mockRejectedValue(new Error('CONFIGURATION_FAILED'));
      const consume = vi.fn();
      await expect(
        f.orchestrator.generate({ ...f.request, consume }),
      ).rejects.toThrow();
      expect(f.text.generate).not.toHaveBeenCalled();
      expect(consume).not.toHaveBeenCalled();
      expect(f.examples).toEqual([]);
    },
  );

  it('no inventa datos cuando una consulta no recupera evidencia suficiente', async () => {
    const f = setup();
    f.search.mockResolvedValue([]);
    const result = await f.orchestrator.generate(f.request);
    expect(result.reply).toMatchObject({
      status: 'INSUFFICIENT_CONTEXT',
      email: null,
      sourcesUsed: [],
    });
    expect(f.text.generate).not.toHaveBeenCalled();
  });

  it('entrega el resultado en memoria y limpia el contexto aunque falle el consumidor', async () => {
    const f = setup();
    let messages: unknown[] | undefined;
    const consume = vi.fn(async (response, context) => {
      expect(response.status).toBe('READY');
      messages = context.modelInput.messages;
      throw new Error('CONSUMER_FAILED');
    });
    await expect(
      f.orchestrator.generate({ ...f.request, consume }),
    ).rejects.toThrow('CONSUMER_FAILED');
    expect(messages).toEqual([]);
    expect(f.examples).toEqual([]);
  });

  it('se abstiene si el acceso autorizado no encuentra perfil y evita leer ejemplos personales', async () => {
    const f = setup();
    f.request.selection.resolveStyle = async () => null;
    const result = await f.orchestrator.generate(f.request);
    expect(result.reply).toMatchObject({
      status: 'INSUFFICIENT_CONTEXT',
      email: null,
      warnings: expect.arrayContaining(['STYLE_PROFILE_UNAVAILABLE']),
    });
    expect(f.deps.styleExamples.retrieve).not.toHaveBeenCalled();
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(f.classify).not.toHaveBeenCalled();
  });
});
