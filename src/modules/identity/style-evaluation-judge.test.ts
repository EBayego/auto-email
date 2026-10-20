import { describe, expect, it, vi } from 'vitest';
import type { BlindStyleCase } from '@/poc/evaluate-style';
import type { TextGenerationClient } from '@/providers/contracts';
import { judgeStyleCandidates } from './style-evaluation-judge';
import { syntheticAutomaticRating } from '../../../tests/fixtures/style-evaluation';
import { ProviderError } from '@/providers/errors';

function blind(): BlindStyleCase {
  return {
    caseId: 'case-01',
    incoming: 'Entrada',
    conversation: [
      { speaker: 'participant_1', text: 'Entrada', isTarget: true },
    ],
    referenceReply:
      'Hola, gracias por el mensaje. Si necesitas algo más me dices. ¡Un saludo!',
    candidates: [
      {
        label: 'A',
        status: 'READY',
        bodyText: 'Hola, gracias por escribir. Un saludo.',
      },
      { label: 'B', status: 'READY', bodyText: 'Recibido. Gracias.' },
      { label: 'C', status: 'READY', bodyText: 'Recibido. Gracias.' },
    ],
  };
}
function judge() {
  return {
    generate: vi.fn<TextGenerationClient['generate']>(async () => ({
      text: JSON.stringify({
        ratings: [
          { label: 'A', assessment: syntheticAutomaticRating(4) },
          {
            label: 'B',
            assessment: syntheticAutomaticRating(2, {
              factors: ['closing', 'warmth', 'helpfulness'],
              confidence: 'low',
            }),
          },
        ],
      }),
      inputTokens: 20,
      outputTokens: 30,
    })),
  };
}
describe('juicio automático de estilo aislado', () => {
  it('evalúa propuestas anónimas y reutiliza la nota de textos idénticos sin convertirla en nota humana', async () => {
    const client = judge();
    const result = await judgeStyleCandidates(client, blind());
    expect(result.modelCalls).toBe(1);
    expect(result.ratings.B).toEqual(result.ratings.C);
    expect(result.ratings.B).not.toBe(result.ratings.C);
    expect(result.ratings.B.additionalScores.warmth).toBe(2);
    expect(result.ratings.B.factors).toContain('closing');
    const request = client.generate.mock.calls[0][0];
    expect(JSON.parse(request.input).candidates).toHaveLength(2);
    expect(request.input).not.toMatch(
      /GENERAL|CONTEXTUAL|profileFingerprint|human/,
    );
    expect(request.instructions).toContain('NUNCA de hechos');
    expect(request.instructions).toContain(
      'No confundas formalidad con calidez',
    );
  });
  it.each([
    'not-json',
    JSON.stringify({
      ratings: [{ label: 'A', assessment: syntheticAutomaticRating(4) }],
    }),
    JSON.stringify({
      ratings: ['A', 'A'].map((label) => ({
        label,
        assessment: syntheticAutomaticRating(4),
      })),
    }),
    JSON.stringify({
      ratings: ['A', 'B'].map((label) => ({
        label,
        assessment: { ...syntheticAutomaticRating(6) },
      })),
    }),
    JSON.stringify({
      ratings: ['A', 'B'].map((label) => ({
        label,
        assessment: { ...syntheticAutomaticRating(4), notes: 'private-copy' },
      })),
    }),
    JSON.stringify({
      ratings: ['A', 'B'].map((label) => ({
        label,
        assessment: syntheticAutomaticRating(4, {
          factors: ['warmth', 'warmth'],
        }),
      })),
    }),
  ])(
    'rechaza juicios incompletos, fuera de escala o con textos libres',
    async (text) => {
      const client = {
        generate: vi
          .fn()
          .mockResolvedValue({ text, inputTokens: 1, outputTokens: 1 }),
      };
      await expect(judgeStyleCandidates(client, blind())).rejects.toMatchObject(
        { code: 'INVALID_AUTOMATIC_REVIEW' },
      );
    },
  );
  it('no llama al modelo cuando no hay propuestas listas', async () => {
    const item = blind();
    item.candidates.forEach((candidate) => {
      candidate.status = 'BLOCKED';
      candidate.bodyText = null;
    });
    const client = judge();
    expect(await judgeStyleCandidates(client, item)).toMatchObject({
      ratings: {},
      modelCalls: 0,
    });
    expect(client.generate).not.toHaveBeenCalled();
  });
  it('valida entradas y uso de tokens y propaga errores del proveedor', async () => {
    const client = judge();
    const item = blind();
    item.referenceReply = '';
    await expect(judgeStyleCandidates(client, item)).rejects.toMatchObject({
      code: 'INVALID_AUTOMATIC_REVIEW',
    });
    expect(client.generate).not.toHaveBeenCalled();
    const generated = await client.generate({
      input: 'test',
      instructions: 'test',
    });
    client.generate.mockResolvedValue({ ...generated, inputTokens: -1 });
    await expect(judgeStyleCandidates(client, blind())).rejects.toMatchObject({
      code: 'INVALID_AUTOMATIC_REVIEW',
    });
    client.generate.mockRejectedValue(
      new ProviderError('openai', 'UNAVAILABLE'),
    );
    await expect(judgeStyleCandidates(client, blind())).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
});
