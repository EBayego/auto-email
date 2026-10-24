import { describe, expect, it, vi } from 'vitest';
import type { TextGenerationClient } from '@/providers/contracts';
import { createResponseGenerator } from './generator';
import { parseGeneratedResponse } from './schema';
import { knowledgeFragment } from '../../../tests/fixtures/knowledge';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from '../../../tests/fixtures/responses';

const knowledge = [knowledgeFragment()];
function input(question = '¿Cuál es el plazo? ¿Cuál es el precio?') {
  const result = responseInput();
  result.conversation.messages[0].text = question;
  return { ...result, knowledge };
}
function partial() {
  return {
    ...readyResponse(),
    status: 'PARTIAL' as const,
    bodyText:
      'Hola, gracias por tu consulta. El plazo de entrega es de siete días. Un saludo.',
    missingInformation: ['La tarifa vigente.'],
    evidence: [
      {
        knowledgeIndex: 0,
        quote: knowledge[0].content,
        claim: knowledge[0].content,
      },
    ],
  };
}
function client(candidate: unknown = partial()) {
  return {
    generate: vi
      .fn<TextGenerationClient['generate']>()
      .mockResolvedValueOnce({
        text: JSON.stringify(candidate),
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
describe('MAIL-041 abstención y propuestas parciales', () => {
  it('EPIC-06 admite evidencia del hilo solo con permiso explícito y lo comunica al verificador', async () => {
    const api = client({
      ...readyResponse(),
      bodyText: 'El precio de Atlas es de 90 euros.',
      evidence: [
        {
          messageIndex: 0,
          quote: 'Precio de Atlas: 90 euros.',
          claim: 'El precio de Atlas es de 90 euros.',
        },
      ],
    });
    const value = input('¿Cuál es el precio de Atlas?');
    value.conversation.messages.unshift({
      speaker: 'owner',
      text: 'Precio de Atlas: 90 euros.',
      isTarget: false,
    });
    const result = await createResponseGenerator(api).generate({
      ...value,
      allowEmailHistory: true,
    });
    expect(result.status).toBe('READY');
    for (const [call] of api.generate.mock.calls)
      expect(JSON.parse(call.input).allowEmailHistory).toBe(true);
  });
  it('EPIC-06 respeta la prohibición de usar emails anteriores como evidencia factual', async () => {
    const api = client({
      ...readyResponse(),
      bodyText: 'El precio de Atlas es de 90 euros.',
      evidence: [
        {
          messageIndex: 0,
          quote: 'Precio de Atlas: 90 euros.',
          claim: 'El precio de Atlas es de 90 euros.',
        },
      ],
    });
    const value = input('¿Cuál es el precio de Atlas?');
    value.conversation.messages.unshift({
      speaker: 'owner',
      text: 'Precio de Atlas: 90 euros.',
      isTarget: false,
    });
    const result = await createResponseGenerator(api).generate({
      ...value,
      allowEmailHistory: false,
    });
    expect(result).toMatchObject({
      status: 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      needsHumanInput: true,
      modelCalls: 0,
    });
    expect(api.generate).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'EPIC-06 no sustituye una tarifa documental vigente por un importe del historial (permiso %s)',
    async (allowEmailHistory) => {
      const api = client({
        ...readyResponse(),
        bodyText: 'El precio de Atlas es de 90 euros.',
        evidence: [
          {
            messageIndex: 0,
            quote: 'Precio de Atlas: 90 euros.',
            claim: 'El precio de Atlas es de 90 euros.',
          },
        ],
      });
      const value = input('¿Cuál es el precio de Atlas?');
      value.conversation.messages.unshift({
        speaker: 'owner',
        text: 'Precio de Atlas: 90 euros.',
        isTarget: false,
      });
      const result = await createResponseGenerator(api).generate({
        ...value,
        knowledge: [
          knowledgeFragment({
            content: 'Precio de Atlas: 125 euros.',
            valid_from: '2000-01-01',
          }),
        ],
        allowEmailHistory,
      });
      expect(result.bodyText).toBeNull();
      expect(result.warnings).toContain('UNVERIFIED_EVIDENCE');
      expect(api.generate).toHaveBeenCalledTimes(1);
    },
  );
  it('se abstiene por defecto antes del modelo cuando falta una parte esencial', async () => {
    const api = client();
    const result = await createResponseGenerator(api).generate(input());
    expect(result).toMatchObject({
      status: 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      needsHumanInput: true,
      modelCalls: 0,
    });
    expect(result.missingInformation.join(' ')).toContain('Tarifa');
    expect(api.generate).not.toHaveBeenCalled();
  });
  it('produce y verifica una parcial con lo pendiente separado y revisión obligatoria', async () => {
    const api = client();
    const result = await createResponseGenerator(api).generate({
      ...input(),
      allowPartialDrafts: true,
    });
    expect(result).toMatchObject({
      status: 'PARTIAL',
      bodyText: partial().bodyText,
      needsHumanInput: true,
      modelCalls: 2,
      warnings: expect.arrayContaining([
        'HUMAN_REVIEW_REQUIRED',
        'MISSING_INFORMATION',
      ]),
    });
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(result.bodyText).not.toMatch(/pendiente|tarifa|\[PRECIO\]/i);
    const verification = JSON.parse(api.generate.mock.calls[1][0].input);
    expect(verification.proposal).toMatchObject({
      status: 'PARTIAL',
      missingInformation: result.missingInformation,
    });
  });
  it('no permite que el modelo transforme una parcial en una respuesta completa', async () => {
    const api = client({
      ...partial(),
      status: 'READY',
      missingInformation: [],
    });
    const result = await createResponseGenerator(api).generate({
      ...input(),
      allowPartialDrafts: true,
    });
    expect(result.status).toBe('INSUFFICIENT_CONTEXT');
    expect(result.bodyText).toBeNull();
    expect(api.generate).toHaveBeenCalledTimes(1);
  });
  it('no habilita parciales sin datos útiles ni para agendas o decisiones', async () => {
    for (const question of [
      '¿Cuál es el precio?',
      '¿Cuál es el plazo? ¿Estás disponible el martes?',
    ]) {
      const api = client();
      const result = await createResponseGenerator(api).generate({
        ...input(question),
        allowPartialDrafts: true,
      });
      expect(result.status).toBe('INSUFFICIENT_CONTEXT');
      expect(api.generate).not.toHaveBeenCalled();
    }
  });
  it('rechaza un importe añadido a una parcial aunque el modelo presente una cita', async () => {
    const api = client({
      ...partial(),
      bodyText: `${partial().bodyText} El precio es 125 EUR.`,
    });
    const result = await createResponseGenerator(api).generate({
      ...input(),
      allowPartialDrafts: true,
    });
    expect(result.warnings).toContain('UNSUPPORTED_FACT');
    expect(result.bodyText).toBeNull();
  });
  it('rechaza fechas y cantidades escritas en palabras sin citas de respaldo', async () => {
    for (const bodyText of [
      'Hola, el plazo es de diez días. Un saludo.',
      'Hola, la entrega será el viernes. Un saludo.',
    ]) {
      const api = client({ ...readyResponse(), bodyText });
      const result =
        await createResponseGenerator(api).generate(responseInput());
      expect(result.bodyText).toBeNull();
      expect(result.warnings).toContain('UNSUPPORTED_FACT');
    }
  });
  it('la verificación independiente puede rechazar una parcial', async () => {
    const api = client();
    api.generate
      .mockReset()
      .mockResolvedValueOnce({
        text: JSON.stringify(partial()),
        inputTokens: 10,
        outputTokens: 10,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: 'INSUFFICIENT_CONTEXT',
          issues: ['UNSUPPORTED_FACT'],
        }),
        inputTokens: 10,
        outputTokens: 10,
      });
    const result = await createResponseGenerator(api).generate({
      ...input(),
      allowPartialDrafts: true,
    });
    expect(result.bodyText).toBeNull();
    expect(result.needsHumanInput).toBe(true);
  });
  it('el contrato exige hechos citados y pendientes internos para PARTIAL', () => {
    expect(parseGeneratedResponse(JSON.stringify(partial())).status).toBe(
      'PARTIAL',
    );
    for (const extra of [
      { missingInformation: [] },
      { evidence: [] },
      { bodyText: null },
    ])
      expect(() =>
        parseGeneratedResponse(JSON.stringify({ ...partial(), ...extra })),
      ).toThrow('INVALID_RESPONSE');
  });
});
