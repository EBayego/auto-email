import { describe, expect, it, vi } from 'vitest';
import type { TextGenerationClient } from '@/providers/contracts';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from '../../../tests/fixtures/responses';
import { knowledgeFragment } from '../../../tests/fixtures/knowledge';
import { createResponseGenerator } from './generator';
import { generateReplyInputSchema } from './input';
import { generatedResponseSchema, generatedResponseZodSchema } from './schema';

const api = (candidate = readyResponse(), verdict = supportedResponse()) => ({
  generate: vi
    .fn<TextGenerationClient['generate']>()
    .mockResolvedValueOnce({
      text: JSON.stringify(candidate),
      inputTokens: 10,
      outputTokens: 5,
    })
    .mockResolvedValueOnce({
      text: JSON.stringify(verdict),
      inputTokens: 8,
      outputTokens: 4,
    }),
});

describe('MAIL-043 contrato del generador', () => {
  it('separa el email de la evaluación y mantiene el contrato anterior', async () => {
    const result =
      await createResponseGenerator(api()).generate(responseInput());
    expect(result).toMatchObject({
      schemaVersion: 1,
      email: { subject: 'Confirmación', bodyText: readyResponse().bodyText },
      evaluation: {
        language: 'es',
        needsHumanReview: true,
        needsHumanInput: false,
        warnings: ['HUMAN_REVIEW_REQUIRED'],
      },
      sourcesUsed: [],
      modelCalls: 2,
    });
    expect(Object.keys(result.email!)).toEqual(['subject', 'bodyText']);
    expect(result.email!.bodyText).toBe(result.bodyText);
    expect(result.evaluation.warnings).not.toBe(result.warnings);
  });

  it.each(['BLOCKED', 'INSUFFICIENT_CONTEXT'] as const)(
    'no ofrece cuerpo ni fuentes al abstenerse: %s',
    async (status) => {
      const result = await createResponseGenerator(
        api({
          ...readyResponse(),
          status,
          bodyText: null,
          missingInformation:
            status === 'BLOCKED' ? [] : ['Información pendiente'],
          warnings: status === 'BLOCKED' ? ['HIGH_RISK'] : [],
        }),
      ).generate(responseInput());
      expect(result.email).toBeNull();
      expect(result.sourcesUsed).toEqual([]);
      expect(result.evaluation.needsHumanReview).toBe(true);
      expect(result.evaluation.needsHumanInput).toBe(true);
    },
  );

  it('conserva referencias del historial fuera del modelo y solo registra las citadas', async () => {
    const claim = 'El plazo de entrega es de siete días.';
    const input = {
      ...responseInput(),
      allowEmailHistory: true,
      historicalContext: [
        { referenceId: 'opaque-history-1', speaker: 'owner', text: claim },
        {
          referenceId: 'unused-history',
          speaker: 'owner',
          text: 'Texto irrelevante.',
        },
      ],
    };
    const provider = api({
      ...readyResponse(),
      bodyText: `Hola. ${claim} Un saludo.`,
      evidence: [{ messageIndex: 0, quote: claim, claim }],
    });
    const result = await createResponseGenerator(provider).generate(input);
    expect(result.status).toBe('READY');
    expect(result.sourcesUsed).toEqual([
      { kind: 'HISTORICAL_MESSAGE', referenceId: 'opaque-history-1' },
    ]);
    for (const [call] of provider.generate.mock.calls) {
      expect(call.input).not.toContain('opaque-history');
      expect(call.input).not.toContain('unused-history');
      const messages = JSON.parse(call.input).conversation.messages;
      expect(messages[0]).toEqual({
        speaker: 'owner',
        text: claim,
        isTarget: false,
      });
      expect(messages.at(-1).isTarget).toBe(true);
    }
    expect(input.historicalContext).toHaveLength(2);
    expect(input.conversation.messages).toHaveLength(1);
  });

  it('resuelve índices del hilo después de añadir historial', async () => {
    const input = responseInput();
    const quote = input.conversation.messages[0].text;
    const provider = api({
      ...readyResponse(),
      evidence: [
        {
          messageIndex: 1,
          quote,
          claim: 'Confirmo que he recibido tu mensaje.',
        },
      ],
    });
    const result = await createResponseGenerator(provider).generate({
      ...input,
      allowEmailHistory: true,
      historicalContext: [
        { referenceId: 'history', speaker: 'owner', text: 'Contexto previo.' },
      ],
    });
    expect(result.sourcesUsed).toEqual([
      { kind: 'THREAD_MESSAGE', messageIndex: 0 },
    ]);
  });

  it('deduplica fuentes documentales verificadas y descarta las meramente recuperadas', async () => {
    const fragment = knowledgeFragment();
    const provider = api({
      ...readyResponse(),
      bodyText: `Hola. ${fragment.content} Un saludo.`,
      evidence: [0, 1].map(() => ({
        knowledgeIndex: 0,
        quote: fragment.content,
        claim: fragment.content,
      })),
    });
    const result = await createResponseGenerator(provider).generate({
      ...responseInput(),
      knowledge: [
        fragment,
        knowledgeFragment({
          chunk_id: '00000000-0000-4000-8000-000000000099',
          position: 1,
        }),
      ],
    });
    expect(result.sourcesUsed).toEqual([
      {
        kind: 'KNOWLEDGE_FRAGMENT',
        sourceId: fragment.source_id,
        documentId: fragment.document_id,
        version: fragment.version,
        chunkId: fragment.chunk_id,
      },
    ]);
    expect(JSON.stringify(result.sourcesUsed)).not.toContain(fragment.content);
  });

  it('borra procedencia de una propuesta rechazada por el verificador', async () => {
    const fragment = knowledgeFragment();
    const provider = api(
      {
        ...readyResponse(),
        bodyText: `Hola. ${fragment.content} Un saludo.`,
        evidence: [
          {
            knowledgeIndex: 0,
            quote: fragment.content,
            claim: fragment.content,
          },
        ],
      },
      { verdict: 'INSUFFICIENT_CONTEXT', issues: ['UNSUPPORTED_FACT'] },
    );
    const result = await createResponseGenerator(provider).generate({
      ...responseInput(),
      knowledge: [fragment],
    });
    expect(result.email).toBeNull();
    expect(result.sourcesUsed).toEqual([]);
  });

  it.each([
    { allowEmailHistory: false },
    { allowEmailHistory: undefined },
    {
      allowEmailHistory: true,
      historicalContext: [
        { referenceId: 'bad id', speaker: 'owner', text: 'Texto.' },
      ],
    },
    {
      allowEmailHistory: true,
      historicalContext: Array.from({ length: 20 }, (_, i) => ({
        referenceId: `history-${i}`,
        speaker: 'owner',
        text: 'Texto.',
      })),
    },
  ])(
    'rechaza historial no autorizado o inválido antes del proveedor: %j',
    async (override) => {
      const provider = api();
      await expect(
        createResponseGenerator(provider).generate({
          ...responseInput(),
          historicalContext: [
            { referenceId: 'history', speaker: 'owner', text: 'Texto.' },
          ],
          ...override,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(provider.generate).not.toHaveBeenCalled();
    },
  );

  it('valida una única entrada objetivo y elimina campos ajenos al contrato', () => {
    const input = responseInput();
    expect(
      generateReplyInputSchema.safeParse({
        ...input,
        conversation: {
          ...input.conversation,
          messages: [
            ...input.conversation.messages,
            ...input.conversation.messages,
          ],
        },
      }).success,
    ).toBe(false);
    const parsed = generateReplyInputSchema.parse({
      ...input,
      secret: 'excluded',
      tools: ['send'],
    });
    expect(parsed).not.toHaveProperty('secret');
    expect(parsed).not.toHaveProperty('tools');
  });

  it('deriva el esquema estricto de Structured Outputs del validador de ejecución', () => {
    expect(generatedResponseSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(generatedResponseSchema).not.toHaveProperty('anyOf');
    expect(generatedResponseSchema.required).toEqual(
      Object.keys(generatedResponseZodSchema.shape),
    );
    expect(
      generatedResponseZodSchema.safeParse({
        ...readyResponse(),
        sourcesUsed: ['invented'],
      }).success,
    ).toBe(false);
  });
});
