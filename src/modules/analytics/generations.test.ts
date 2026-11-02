import { describe, expect, it } from 'vitest';
import {
  estimateGenerationCost,
  readGenerationPricing,
  generationRetentionUpdateSchema,
  generationConfiguration,
} from './generations';
import type { GenerationObservation } from './generations';
import { writingProfileFixture } from '../../../tests/fixtures/writing-profile';

describe('MAIL-056 metadatos y estimación de costes', () => {
  it('estima USD por millón con redondeo conservador, incluyendo ambos consumos', () => {
    expect(
      estimateGenerationCost(200, 60, {
        inputUsdPerMillion: 1.5,
        outputUsdPerMillion: 6,
      }),
    ).toBe(0.00066);
    expect(
      estimateGenerationCost(1, 0, {
        inputUsdPerMillion: 0.001,
        outputUsdPerMillion: 0,
      }),
    ).toBe(0.00000001);
    expect(
      estimateGenerationCost(0, 0, {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 1,
      }),
    ).toBe(0);
  });
  it('distingue el consumo desconocido y las tarifas sin configurar de un coste cero', () => {
    expect(readGenerationPricing({})).toBeNull();
    expect(estimateGenerationCost(200, 60, null)).toBeNull();
    expect(
      estimateGenerationCost(null, null, {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 1,
      }),
    ).toBeNull();
    expect(
      readGenerationPricing({
        OPENAI_INPUT_USD_PER_MILLION: '1.50',
        OPENAI_OUTPUT_USD_PER_MILLION: '6',
      }),
    ).toEqual({ inputUsdPerMillion: 1.5, outputUsdPerMillion: 6 });
  });
  it.each(['-1', 'NaN', 'Infinity', '1e3', '1000001', ''])(
    'rechaza tarifas incompletas o inválidas: %s',
    (value) => {
      expect(() =>
        readGenerationPricing({
          OPENAI_INPUT_USD_PER_MILLION: value,
          OPENAI_OUTPUT_USD_PER_MILLION: '1',
        }),
      ).toThrow('OPENAI_INPUT_USD_PER_MILLION');
    },
  );
  it('captura la configuración sin incluir correos, instrucciones ni textos documentales', () => {
    const observation = {
      context: {
        styleRevision: crypto.randomUUID(),
        modelInput: {
          style: writingProfileFixture(),
          subject: 'PRIVATE_SUBJECT',
          messages: [{ text: 'PRIVATE_EMAIL' }],
        },
      },
      response: null,
      userInstructions: ['PRIVATE_INSTRUCTIONS'],
      knowledge: {
        plan: {
          revision: 'a'.repeat(32),
          matchedRuleIds: [],
          allowEmailHistory: false,
        },
        consultedSourceIds: [crypto.randomUUID()],
        matches: [
          {
            source_id: crypto.randomUUID(),
            document_id: crypto.randomUUID(),
            chunk_id: crypto.randomUUID(),
            version: 2,
            content: 'PRIVATE_DOCUMENT',
          },
        ],
        allowPartialDrafts: false,
      },
    } as unknown as GenerationObservation;
    const snapshot = generationConfiguration(observation, {
      reasoningEffort: 'none',
      maxOutputTokens: 2048,
    });
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_');
    expect(snapshot.knowledgeFragments[0].version).toBe(2);
    expect(snapshot.userInstructionsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.consultedSourceIds).toEqual(
      observation.knowledge!.consultedSourceIds,
    );
    observation.context.modelInput.style!.style_description =
      'Descripción modificada.';
    expect(snapshot.style?.style_description).not.toBe(
      'Descripción modificada.',
    );
  });
  it('exige aceptación explícita de la versión y limita la conservación a siete días', () => {
    const valid = {
      accountId: crypto.randomUUID(),
      enabled: true,
      retentionHours: 24,
      noticeVersion: 'mail056-v1',
    };
    expect(generationRetentionUpdateSchema.safeParse(valid).success).toBe(true);
    for (const change of [
      { noticeVersion: undefined },
      { retentionHours: 169 },
      { retentionHours: 0 },
      { bodyText: 'private' },
      { userId: crypto.randomUUID() },
    ])
      expect(
        generationRetentionUpdateSchema.safeParse({ ...valid, ...change })
          .success,
      ).toBe(false);
    expect(
      generationRetentionUpdateSchema.safeParse({
        accountId: valid.accountId,
        enabled: false,
      }).success,
    ).toBe(true);
  });
  it('conserva las preferencias efectivas aplicadas por la petición sin guardar instrucciones', () => {
    const input = {
      context: {
        modelInput: { style: null },
        stylePreferences: {
          preferences: [{ key: 'greeting', value: 'none' }],
          revisions: [crypto.randomUUID()],
        },
      },
      response: { examplesUsed: 0 },
      userInstructions: ['No uses saludos largos'],
    } as unknown as GenerationObservation;
    const snapshot = generationConfiguration(input, {});
    expect(snapshot.preferences).toEqual([{ key: 'greeting', value: 'short' }]);
    expect(JSON.stringify(snapshot)).not.toContain('No uses saludos largos');
  });
});
