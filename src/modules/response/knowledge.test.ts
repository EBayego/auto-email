import { describe, expect, it, vi } from 'vitest';
import type { TextGenerationClient } from '@/providers/contracts';
import { createResponseGenerator } from './generator';
import { parseGeneratedResponse } from './schema';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from '../../../tests/fixtures/responses';
import {
  knowledgeFragment,
  knowledgeId,
} from '../../../tests/fixtures/knowledge';

const fragment = knowledgeFragment();
function candidate() {
  return {
    ...readyResponse(),
    bodyText:
      'Hola, gracias por tu consulta. El plazo de entrega es de siete días. Un saludo.',
    evidence: [
      { knowledgeIndex: 0, quote: fragment.content, claim: fragment.content },
    ],
  };
}
function client(response: unknown = candidate()) {
  return {
    generate: vi
      .fn<TextGenerationClient['generate']>()
      .mockResolvedValueOnce({
        text: JSON.stringify(response),
        inputTokens: 10,
        outputTokens: 10,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(supportedResponse()),
        inputTokens: 10,
        outputTokens: 10,
      }),
  };
}
describe('MAIL-039 evidencia documental en generación', () => {
  it('MAIL-040 exige revisión sin consultar el modelo ante contradicciones irresolubles', async () => {
    const api = client();
    const result = await createResponseGenerator(api).generate({
      ...responseInput(),
      knowledge: [
        knowledgeFragment({ content: 'Plazo: 7 días.' }),
        knowledgeFragment({
          content: 'Plazo: 10 días.',
          document_id: knowledgeId(202),
          chunk_id: knowledgeId(102),
        }),
      ],
    });
    expect(result).toMatchObject({
      status: 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      modelCalls: 0,
      warnings: expect.arrayContaining(['KNOWLEDGE_CONFLICT']),
      knowledgePolicy: { action: 'REVIEW_REQUIRED' },
    });
    expect(api.generate).not.toHaveBeenCalled();
  });
  it('MAIL-040 respeta la señal de conflicto que el recuperador encontró fuera del contexto final', async () => {
    const api = client();
    const result = await createResponseGenerator(api).generate({
      ...responseInput(),
      knowledge: [fragment],
      knowledgePolicy: {
        action: 'REVIEW_REQUIRED',
        reasons: ['KNOWLEDGE_CONFLICT'],
      },
    });
    expect(result.modelCalls).toBe(0);
    expect(result.bodyText).toBeNull();
  });
  it('MAIL-040 no permite que una política ALLOW_DRAFT suministrada salte la revisión de vigencia', async () => {
    const api = client();
    const result = await createResponseGenerator(api).generate({
      ...responseInput(),
      knowledge: [knowledgeFragment({ valid_until: '2000-01-01' })],
      knowledgePolicy: { action: 'ALLOW_DRAFT', reasons: [] },
    });
    expect(result.warnings).toContain('KNOWLEDGE_NOT_CURRENT');
    expect(api.generate).not.toHaveBeenCalled();
  });
  it('MAIL-040 solo entrega al modelo el valor de la fuente con mayor autoridad cuando hay resolución', async () => {
    const api = client();
    await createResponseGenerator(api).generate({
      ...responseInput(),
      knowledge: [
        fragment,
        knowledgeFragment({
          content: 'El plazo de entrega es de diez días.',
          source_priority: 100,
          document_id: knowledgeId(202),
          chunk_id: knowledgeId(102),
        }),
      ],
    });
    expect(JSON.parse(api.generate.mock.calls[0][0].input).knowledge).toEqual([
      fragment,
    ]);
  });
  it('entrega los mismos fragmentos autorizados al generador y al verificador y resuelve las referencias', async () => {
    const api = client();
    const knowledge = [fragment];
    const result = await createResponseGenerator(api).generate({
      ...responseInput(),
      knowledge,
    });
    expect(result.status).toBe('READY');
    expect(result.evidence).toEqual(candidate().evidence);
    expect(result.knowledgeReferences).toMatchObject([
      {
        knowledgeIndex: 0,
        sourceId: fragment.source_id,
        documentId: fragment.document_id,
        version: fragment.version,
        chunkId: fragment.chunk_id,
        document_updated_at: fragment.document_updated_at,
        currency: 'UNSPECIFIED',
      },
    ]);
    for (const [call] of api.generate.mock.calls) {
      expect(JSON.parse(call.input).knowledge).toEqual(knowledge);
      expect(call.instructions).toContain('knowledge');
    }
    expect(knowledge).toEqual([fragment]);
  });
  it.each([
    { knowledgeIndex: 1, quote: fragment.content, claim: fragment.content },
    {
      knowledgeIndex: 0,
      quote: 'El plazo es de un día.',
      claim: fragment.content,
    },
    {
      knowledgeIndex: 0,
      quote: fragment.document_name,
      claim: fragment.content,
    },
  ])(
    'rechaza referencias o citas documentales que no están en el contenido: %j',
    async (evidence) => {
      const api = client({ ...candidate(), evidence: [evidence] });
      const result = await createResponseGenerator(api).generate({
        ...responseInput(),
        knowledge: [fragment],
      });
      expect(result).toMatchObject({
        status: 'INSUFFICIENT_CONTEXT',
        bodyText: null,
        evidence: [],
        knowledgeReferences: [],
        warnings: expect.arrayContaining(['UNVERIFIED_EVIDENCE']),
      });
      expect(api.generate).toHaveBeenCalledTimes(1);
    },
  );
  it('una fuente documental no autoriza promesas del titular aunque contenga una cita literal', async () => {
    const content = 'Podemos entregar el informe mañana.';
    const api = client({
      ...candidate(),
      bodyText: `Hola, ${content} Un saludo.`,
      evidence: [{ knowledgeIndex: 0, quote: content, claim: content }],
    });
    const result = await createResponseGenerator(api).generate({
      ...responseInput(),
      knowledge: [knowledgeFragment({ content })],
    });
    expect(result.warnings).toContain('UNSUPPORTED_COMMITMENT');
    expect(result.bodyText).toBeNull();
  });
  it('rechaza hechos numéricos nuevos y mantiene la verificación independiente', async () => {
    const api = client({
      ...candidate(),
      bodyText: 'Hola, el plazo de entrega es de 7 días. Un saludo.',
      evidence: [
        {
          knowledgeIndex: 0,
          quote: fragment.content,
          claim: 'el plazo de entrega es de 7 días',
        },
      ],
    });
    const result = await createResponseGenerator(api).generate({
      ...responseInput(),
      knowledge: [fragment],
    });
    expect(result.warnings).toContain('UNSUPPORTED_FACT');
    expect(result.bodyText).toBeNull();
  });
  it('valida cantidad, metadatos y presupuesto antes de llamar al modelo', async () => {
    for (const knowledge of [
      Array.from({ length: 9 }, () => fragment),
      [{ ...fragment, version: 0 }],
      Array.from({ length: 8 }, () => ({
        ...fragment,
        content: 'Plazo '.repeat(600),
      })),
    ]) {
      const api = client();
      await expect(
        createResponseGenerator(api).generate({
          ...responseInput(),
          knowledge,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(api.generate).not.toHaveBeenCalled();
    }
  });
  it('exige exactamente un tipo de referencia por cita en la salida estructurada', () => {
    expect(
      parseGeneratedResponse(JSON.stringify(candidate())).evidence,
    ).toEqual(candidate().evidence);
    for (const evidence of [
      { ...candidate().evidence[0], messageIndex: 0 },
      { ...candidate().evidence[0], knowledgeIndex: 8 },
      { ...candidate().evidence[0], knowledgeIndex: -1 },
    ])
      expect(() =>
        parseGeneratedResponse(
          JSON.stringify({ ...candidate(), evidence: [evidence] }),
        ),
      ).toThrow('INVALID_RESPONSE');
  });
});
