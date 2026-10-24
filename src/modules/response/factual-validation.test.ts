import { describe, expect, it, vi } from 'vitest';
import {
  responseInput,
  readyResponse,
  supportedResponse,
} from '../../../tests/fixtures/responses';
import {
  knowledgeFragment,
  knowledgeConfiguration,
  knowledgeCandidate,
} from '../../../tests/fixtures/knowledge';
import {
  validateResponseFacts,
  factualAudit,
  verifiedFactsAtWrite,
  applyFactualValidation,
} from './factual-validation';
import { createResponseGenerator } from './generator';
import { createReplyOrchestrator } from './orchestrator';
import { finalizeReplyResult } from './result';
import { createKnowledgeRetriever } from '@/modules/knowledge/retriever';
import {
  documentAudienceSchema,
  audienceMatches,
} from '@/modules/knowledge/audience';
import { draftFixture } from '../../../tests/fixtures/drafts';
import { createDraftWriter } from '@/modules/gmail/draft-writer';
import { selectPendingEmail } from '@/modules/gmail/manual-selection';

const recipient = 'contact@example.invalid';
function check(
  claim: string,
  source = claim,
  extra: Partial<ReturnType<typeof knowledgeFragment>> = {},
) {
  const input = {
    ...responseInput(),
    recipient,
    knowledge: [
      knowledgeFragment({
        content: source,
        valid_from: '2020-01-01',
        valid_until: '2099-12-31',
        ...extra,
      }),
    ],
  };
  const response = {
    ...readyResponse(),
    bodyText: claim,
    evidence: [{ knowledgeIndex: 0, quote: source, claim }],
  };
  return {
    input,
    response,
    validation: validateResponseFacts(input, response),
  };
}
describe('MAIL-046 validación factual determinista', () => {
  it('MAIL-047 los joiners válidos no permiten ocultar un compromiso sin respaldo', () => {
    const validation = validateResponseFacts(responseInput(), {
      ...readyResponse(),
      bodyText: 'Envia\u200dremos el documento.',
    });
    expect(validation.status).toBe('REVIEW_REQUIRED');
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ reason: 'UNAUTHORIZED_COMMITMENT' }),
    );
  });
  it.each([
    ['El precio es -125 €.', 'El precio es 125 €.'],
    ['El precio es -€125.', 'El precio es €125.'],
    ['La capacidad es 200 kg.', 'La capacidad es 200 g.'],
  ])('verifica signo y unidad de la cantidad: %s', (claim, source) =>
    expect(check(claim, source).validation.status).toBe('REVIEW_REQUIRED'),
  );
  it.each([
    'La fecha es 2026-02-30.',
    'La fecha es 30/02/2026.',
    'El horario es 25:00.',
  ])(
    'rechaza un valor imposible incluso si la fuente lo contiene: %s',
    (claim) => {
      expect(check(claim).validation.issues).toContainEqual(
        expect.objectContaining({ reason: 'INVALID_VALUE' }),
      );
    },
  );
  it('requiere resolver fechas relativas para no trasladar el mañana de un correo antiguo', () => {
    expect(check('El plazo termina mañana.').validation.issues).toContainEqual(
      expect.objectContaining({ reason: 'AMBIGUOUS_DATE' }),
    );
  });
  it.each([
    'El precio Atlas es 125 €.',
    'El plazo es de 7 días laborables.',
    'La fecha límite es el 2026-11-12.',
    'El paquete incluye 12 licencias.',
    'La tarifa es de 100 € al mes, IVA incluido.',
    'La devolución requiere presentar el recibo.',
  ])('admite evidencia exacta: %s', (claim) =>
    expect(check(claim).validation.status).toBe('SUPPORTED'),
  );

  it.each([
    [
      'El precio Atlas es 90 €.',
      'El precio Atlas es 125 €. El precio Nimbo es 90 €.',
    ],
    ['El plazo es de 5 días.', 'El plazo es de 7 días.'],
    ['La fecha límite es el 2026-11-13.', 'La fecha límite es el 2026-11-12.'],
    ['El paquete incluye 20 licencias.', 'El paquete incluye 12 licencias.'],
    ['El precio Atlas es 125 €.', 'El precio Nimbo es 125 €.'],
    [
      'La tarifa es de 100 € IVA incluido.',
      'La tarifa es de 100 € IVA excluido.',
    ],
    ['La tarifa es de 100 €.', 'La tarifa es de 100 € al mes.'],
    ['El plazo es de 7 días.', 'El plazo es de 7 días laborables.'],
    [
      'La devolución requiere presentar el recibo.',
      'La devolución no requiere presentar el recibo.',
    ],
    ['La tarifa es de 100 €.', 'La tarifa es de hasta 100 €.'],
  ])('rechaza dato incorrecto o condición perdida: %s', (claim, source) => {
    const { validation } = check(claim, source);
    expect(validation.status).toBe('REVIEW_REQUIRED');
    expect(validation.missingInformation.join(' ')).toContain(claim);
  });

  it('no mezcla importes de dos citas diferentes', () => {
    const { input, response } = check(
      'El precio Atlas es 90 €.',
      'El precio Atlas es 125 €.',
    );
    input.knowledge.push(
      knowledgeFragment({
        content: 'El precio Nimbo es 90 €.',
        valid_from: '2020-01-01',
        chunk_id: '00000000-0000-4000-8000-000000000099',
      }),
    );
    response.evidence.push({
      knowledgeIndex: 1,
      quote: 'El precio Nimbo es 90 €.',
      claim: 'El precio Atlas es 90 €.',
    });
    expect(validateResponseFacts(input, response).status).toBe(
      'REVIEW_REQUIRED',
    );
  });
  it('un compromiso histórico tampoco sustituye una tarifa documental vigente', () => {
    const { input, response } = check(
      'Podemos ofrecer Atlas por 90 euros.',
      'El precio de Atlas es de 125 euros.',
    );
    input.conversation.messages[0].text = '¿Cuál es el precio de Atlas?';
    input.conversation.messages.unshift({
      speaker: 'owner',
      text: 'Podemos ofrecer Atlas por 90 euros.',
      isTarget: false,
    });
    const proposed = {
      ...response,
      evidence: [
        {
          messageIndex: 0,
          quote: 'Podemos ofrecer Atlas por 90 euros.',
          claim: response.bodyText,
        },
      ],
    };
    expect(
      validateResponseFacts({ ...input, allowEmailHistory: true }, proposed)
        .issues,
    ).toContainEqual(expect.objectContaining({ reason: 'SOURCE_NOT_CURRENT' }));
  });
  it.each([
    [
      'El precio Atlas es 90 € y el precio Nimbo es 125 €.',
      'El precio Atlas es 125 € y el precio Nimbo es 90 €.',
    ],
    [
      'El precio Atlas es 90 €, el precio Nimbo es 125 €.',
      'El precio Atlas es 125 €, el precio Nimbo es 90 €.',
    ],
    [
      'La tarifa es de 100 €.',
      'La tarifa es de 100 €; solo si se contratan 12 meses.',
    ],
    [
      'La tarifa es de 100 €.',
      'La tarifa es de 100 €. Solo si se contratan 12 meses.',
    ],
    [
      'La tarifa es de 100 €.',
      'La tarifa es de 100 € y requiere contratar 12 meses.',
    ],
  ])(
    'no agrupa afirmaciones ni recorta condiciones próximas: %s',
    (claim, source) => {
      const { input, response } = check(claim, source);
      if (claim === 'La tarifa es de 100 €.')
        response.evidence[0].quote = 'La tarifa es de 100 €';
      expect(validateResponseFacts(input, response).status).toBe(
        'REVIEW_REQUIRED',
      );
    },
  );
  it('detecta una afirmación no declarada y localiza el dato ausente', () => {
    const { input, response } = check('El plazo es de 7 días.');
    response.bodyText += ' El paquete incluye 20 licencias.';
    const validation = validateResponseFacts(input, response);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ reason: 'MISSING_EVIDENCE', kind: 'QUANTITY' }),
    );
    expect(validation.missingInformation.join(' ')).toContain('20 licencias');
    const failed = validation.issues[0];
    expect(response.bodyText.slice(failed.start, failed.end)).toContain(
      '20 licencias',
    );
  });
  it('no permite esconder un hecho después del saludo', () => {
    const input = responseInput();
    expect(
      validateResponseFacts(input, {
        ...readyResponse(),
        bodyText: 'Hola, el servicio es gratuito.',
      }).status,
    ).toBe('REVIEW_REQUIRED');
  });
  it('no acepta valores procedentes del perfil ni de ejemplos de estilo', () => {
    const input = {
      ...responseInput(),
      styleExamples: [{ text: 'El paquete incluye 20 licencias.' }],
    };
    expect(
      validateResponseFacts(input, {
        ...readyResponse(),
        bodyText: 'El paquete incluye 20 licencias.',
      }).status,
    ).toBe('REVIEW_REQUIRED');
  });
  it('comprueba la frase completa alrededor de una cita recortada', () => {
    const { input, response } = check(
      'La tarifa es de 100 €.',
      'La tarifa es de 100 € solo si se contratan 12 meses.',
    );
    response.evidence[0].quote = 'La tarifa es de 100 €';
    expect(validateResponseFacts(input, response).status).toBe(
      'REVIEW_REQUIRED',
    );
  });
  it.each([
    {
      audience_kind: 'RECIPIENT' as const,
      audience_key: 'another@example.invalid',
    },
    { audience_kind: 'DOMAIN' as const, audience_key: 'other.invalid' },
  ])('rechaza evidencia del destinatario equivocado: %j', (audience) => {
    expect(
      check('El plazo es de 7 días.', undefined, audience).validation.issues,
    ).toContainEqual(expect.objectContaining({ reason: 'RECIPIENT_MISMATCH' }));
  });
  it.each([
    { audience_kind: 'RECIPIENT' as const, audience_key: recipient },
    { audience_kind: 'DOMAIN' as const, audience_key: 'example.invalid' },
    { audience_kind: 'GENERAL' as const, audience_key: '' },
  ])('admite el alcance autorizado: %j', (audience) =>
    expect(
      check('El plazo es de 7 días.', undefined, audience).validation.status,
    ).toBe('SUPPORTED'),
  );

  it('contrasta las etiquetas de cliente explícitas del documento', () => {
    const { input, response } = check(
      'El plazo es de 7 días.',
      'Cliente: another@example.invalid\nEl plazo es de 7 días.',
    );
    response.evidence[0].quote = 'El plazo es de 7 días.';
    expect(validateResponseFacts(input, response).issues).toContainEqual(
      expect.objectContaining({ reason: 'RECIPIENT_MISMATCH' }),
    );
  });
  it.each([undefined, 'another@example.invalid'])(
    'no reutiliza historial externo sin acreditar su destinatario: %s',
    (historyRecipient) => {
      const input = {
        ...responseInput(),
        recipient,
        allowEmailHistory: true,
        historicalContext: [
          {
            referenceId: 'other',
            speaker: 'owner',
            text: 'El plazo es de 7 días.',
            recipient: historyRecipient,
          },
        ],
      };
      const response = {
        ...readyResponse(),
        bodyText: 'El plazo es de 7 días.',
        evidence: [
          {
            messageIndex: 0,
            quote: 'El plazo es de 7 días.',
            claim: 'El plazo es de 7 días.',
          },
        ],
      };
      expect(validateResponseFacts(input, response).issues).toContainEqual(
        expect.objectContaining({ reason: 'RECIPIENT_MISMATCH' }),
      );
      input.historicalContext[0].recipient = recipient;
      expect(validateResponseFacts(input, response).status).toBe('SUPPORTED');
    },
  );
  it.each([
    { valid_from: null, valid_until: null },
    { valid_from: null, valid_until: '2000-01-01' },
  ])('exige vigencia declarada para importes: %j', (validity) =>
    expect(
      check('El precio es 125 €.', undefined, validity).validation.status,
    ).toBe('REVIEW_REQUIRED'),
  );

  it('no considera una pregunta como confirmación factual', () => {
    const input = responseInput();
    input.conversation.messages[0].text = '¿El plazo es de 7 días?';
    const response = {
      ...readyResponse(),
      bodyText: 'El plazo es de 7 días.',
      evidence: [
        {
          messageIndex: 0,
          quote: 'El plazo es de 7 días',
          claim: 'El plazo es de 7 días.',
        },
      ],
    };
    expect(validateResponseFacts(input, response).status).toBe(
      'REVIEW_REQUIRED',
    );
  });
  it('conserva la comprobación semántica independiente y registra su veto factual', async () => {
    const text = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          text: JSON.stringify(readyResponse()),
          inputTokens: 1,
          outputTokens: 1,
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            verdict: 'INSUFFICIENT_CONTEXT',
            issues: ['UNSUPPORTED_FACT'],
          }),
          inputTokens: 1,
          outputTokens: 1,
        }),
    };
    const result =
      await createResponseGenerator(text).generate(responseInput());
    expect(result.factualValidation).toMatchObject({
      status: 'REVIEW_REQUIRED',
      issues: [{ reason: 'SEMANTIC_REJECTION' }],
    });
    expect(result.bodyText).toBeNull();
  });
  it('un SUPPORTED del modelo no salva un dato incorrecto', async () => {
    const { input, response } = check(
      'El precio Atlas es 90 €.',
      'El precio Atlas es 125 €. El precio Nimbo es 90 €.',
    );
    const text = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          text: JSON.stringify(response),
          inputTokens: 1,
          outputTokens: 1,
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(supportedResponse()),
          inputTokens: 1,
          outputTokens: 1,
        }),
    };
    const result = await createResponseGenerator(text).generate(input);
    expect(result.bodyText).toBeNull();
    expect(result.factualValidation?.status).toBe('REVIEW_REQUIRED');
    expect(text.generate).toHaveBeenCalledTimes(1);
  });
  it('excluye direcciones y alcance de ambos payloads del modelo', async () => {
    const { input, response } = check('El plazo es de 7 días.', undefined, {
      audience_kind: 'RECIPIENT',
      audience_key: recipient,
    });
    const text = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          text: JSON.stringify(response),
          inputTokens: 1,
          outputTokens: 1,
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(supportedResponse()),
          inputTokens: 1,
          outputTokens: 1,
        }),
    };
    expect((await createResponseGenerator(text).generate(input)).status).toBe(
      'READY',
    );
    for (const [call] of text.generate.mock.calls) {
      expect(call.input).not.toContain(recipient);
      expect(call.input).not.toContain('audience_key');
    }
  });
  it('la auditoría contiene motivos y posiciones, sin texto ni valores literales', () => {
    const { validation } = check(
      'El precio Atlas es 90 €.',
      'El precio Atlas es 125 €.',
    );
    const serialized = JSON.stringify(factualAudit(validation));
    for (const secret of [
      'Atlas',
      '90',
      '125',
      'quote',
      'claimText',
      recipient,
    ])
      expect(serialized).not.toContain(`"${secret}"`);
    expect(factualAudit(validation).issues[0].reason).toBeDefined();
  });
  it('vincula el resultado al cuerpo, conversación, evidencias y destinatario reales', () => {
    const { input, response, validation } = check('El plazo es de 7 días.');
    const result = { ...response, factualValidation: validation };
    expect(verifiedFactsAtWrite(input, result)?.status).toBe('SUPPORTED');
    expect(
      verifiedFactsAtWrite(input, {
        ...result,
        bodyText: 'El plazo es de 5 días.',
      }),
    ).toBeNull();
    expect(
      verifiedFactsAtWrite(
        { ...input, recipient: 'other@example.invalid' },
        result,
      ),
    ).toBeNull();
    expect(
      verifiedFactsAtWrite(
        {
          ...input,
          conversation: { ...input.conversation, subject: 'Otro hilo' },
        },
        result,
      ),
    ).toBeNull();
    expect(verifiedFactsAtWrite(input, { ...result, evidence: [] })).toBeNull();
    expect(
      verifiedFactsAtWrite(input, {
        ...result,
        factualValidation: structuredClone(validation),
      }),
    ).toBeNull();
    expect(
      verifiedFactsAtWrite(input, {
        ...result,
        factualValidation: { ...validation, bodyHash: 'malformed' },
      }),
    ).toBeNull();
  });
  it('el orquestador comprueba y audita incluso un generador alternativo', async () => {
    const f = draftFixture();
    const response = finalizeReplyResult(
      {
        ...readyResponse(),
        bodyText: 'El paquete incluye 20 licencias.',
        inputTokens: 1,
        outputTokens: 1,
        modelCalls: 2,
        examplesUsed: 0,
      },
      null,
      [],
    );
    const record = vi.fn().mockResolvedValue(undefined);
    const result = await createReplyOrchestrator({
      gmail: f.gmail,
      generator: { generate: vi.fn().mockResolvedValue(response) },
      styleExamples: { retrieve: vi.fn().mockResolvedValue([]) },
      factualValidation: { record },
    }).generate({ selection: f.selection, styleExamplesLimit: 0 });
    expect(result.reply?.email).toBeNull();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][1]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      issues: [{ reason: 'MISSING_EVIDENCE' }],
    });
    expect(JSON.stringify(record.mock.calls[0][1])).not.toContain('licencias');
  });
  it('el escritor bloquea un READY factual sin validación antes de reservar o llamar a Gmail', async () => {
    const f = draftFixture();
    await selectPendingEmail(f.gmail, f.selection, async (context) => {
      await expect(
        createDraftWriter({ gmail: f.gmail, store: f.store }).create({
          selection: f.selection,
          context,
          response: {
            ...readyResponse(),
            bodyText: 'El paquete incluye 20 licencias.',
            inputTokens: 1,
            outputTokens: 1,
            modelCalls: 2,
            examplesUsed: 0,
          },
          model: 'test',
        }),
      ).rejects.toMatchObject({ code: 'RESPONSE_NOT_READY' });
    });
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('vuelve a comprobar el resultado en el permiso final y audita una alteración', async () => {
    const f = draftFixture();
    const record = vi.fn().mockResolvedValue(undefined);
    await selectPendingEmail(f.gmail, f.selection, async (context) => {
      const input = {
        conversation: context.modelInput,
        recipient: context.replyTarget.to.address,
      };
      const response = {
        ...readyResponse(),
        inputTokens: 1,
        outputTokens: 1,
        modelCalls: 2,
        examplesUsed: 0,
        factualValidation: validateResponseFacts(input, readyResponse()),
      };
      const original = f.store.reserve.getMockImplementation()!;
      f.store.reserve.mockImplementation(async (reservation) => {
        response.bodyText = 'El paquete incluye 20 licencias.';
        return original(reservation);
      });
      expect(
        await createDraftWriter({
          gmail: f.gmail,
          store: f.store,
          recordFactualValidation: record,
        }).create({ selection: f.selection, context, response, model: 'test' }),
      ).toMatchObject({ status: 'CANCELLED', reason: 'PREWRITE_FAILED' });
    });
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][0]).toMatchObject({
      status: 'REVIEW_REQUIRED',
      issues: [expect.objectContaining({ reason: 'MISSING_EVIDENCE' })],
    });
    expect(f.store.created).not.toHaveBeenCalled();
  });
  it('no entrega la propuesta al consumidor si falla la auditoría', async () => {
    const f = draftFixture(),
      consume = vi.fn();
    await expect(
      createReplyOrchestrator({
        gmail: f.gmail,
        generator: createResponseGenerator(f.text),
        styleExamples: { retrieve: vi.fn().mockResolvedValue([]) },
        factualValidation: {
          record: vi.fn().mockRejectedValue(new Error('AUDIT_UNAVAILABLE')),
        },
      }).generate({ selection: f.selection, styleExamplesLimit: 0, consume }),
    ).rejects.toThrow('AUDIT_UNAVAILABLE');
    expect(consume).not.toHaveBeenCalled();
  });
  it('los veredictos de revisión sobreviven al saneamiento de la propuesta', () => {
    const { input, response } = check(
      'El plazo es de 5 días.',
      'El plazo es de 7 días.',
    );
    const result = applyFactualValidation(
      input,
      finalizeReplyResult(
        {
          ...response,
          evidence: [],
          inputTokens: 1,
          outputTokens: 1,
          modelCalls: 2,
          examplesUsed: 0,
          knowledgeReferences: [],
        },
        null,
        [],
      ),
    );
    expect(applyFactualValidation(input, result)).toBe(result);
  });
});

describe('MAIL-046 filtrado de destinatario antes de generar', () => {
  it('MAIL-047 comprueba la audiencia completa y no solo al destinatario principal', () => {
    const { input, response } = check('El plazo es de 7 días.', undefined, {
      audience_kind: 'RECIPIENT',
      audience_key: recipient,
    });
    expect(
      validateResponseFacts(
        { ...input, recipients: [recipient, 'copy@example.invalid'] },
        response,
      ).status,
    ).toBe('REVIEW_REQUIRED');
    const general = {
      ...input,
      recipients: [recipient, 'copy@example.invalid'],
      knowledge: [
        {
          ...input.knowledge[0],
          audience_kind: 'GENERAL' as const,
          audience_key: '',
        },
      ],
    };
    const validation = validateResponseFacts(general, response);
    expect(validation.status).toBe('SUPPORTED');
    expect(
      verifiedFactsAtWrite(general, {
        ...response,
        factualValidation: validation,
      })?.status,
    ).toBe('SUPPORTED');
    expect(
      verifiedFactsAtWrite(
        { ...general, recipients: [recipient, 'new@example.invalid'] },
        { ...response, factualValidation: validation },
      ),
    ).toBeNull();
  });
  it('MAIL-047 no comparte con un nuevo Cc un hecho de un mensaje anterior privado', () => {
    const input = {
      ...responseInput(),
      recipient,
      recipients: [recipient, 'copy@example.invalid'],
      allowEmailHistory: true,
    };
    input.conversation.messages.unshift({
      speaker: 'owner',
      text: 'El plazo es de 7 días.',
      isTarget: false,
    });
    const response = {
      ...readyResponse(),
      bodyText: 'El plazo es de 7 días.',
      evidence: [
        {
          messageIndex: 0,
          quote: 'El plazo es de 7 días.',
          claim: 'El plazo es de 7 días.',
        },
      ],
    };
    expect(
      validateResponseFacts(
        {
          ...input,
          messageAudiences: [[recipient], [recipient, 'copy@example.invalid']],
        },
        response,
      ).issues,
    ).toContainEqual(expect.objectContaining({ reason: 'RECIPIENT_MISMATCH' }));
    expect(
      validateResponseFacts(
        {
          ...input,
          messageAudiences: [
            [recipient, 'copy@example.invalid'],
            [recipient, 'copy@example.invalid'],
          ],
        },
        response,
      ).status,
    ).toBe('SUPPORTED');
  });
  it('MAIL-047 filtra una fuente restringida antes del contexto del grupo', async () => {
    const search = vi.fn().mockResolvedValue([
      knowledgeCandidate(1, {
        audience_kind: 'RECIPIENT',
        audience_key: recipient,
      }),
    ]);
    const retriever = createKnowledgeRetriever({
      configuration: async () => knowledgeConfiguration(),
      search,
      assertRevision: vi.fn(),
    });
    const result = await retriever.retrieve({
      question: '¿Cuál es el plazo de entrega?',
      intent: 'REQUEST_INFORMATION',
      recipient,
      recipients: [recipient, 'copy@example.invalid'],
    });
    expect(result.matches).toEqual([]);
  });
  it('normaliza el alcance y rechaza dominios comodín o direcciones inválidas', () => {
    expect(
      documentAudienceSchema.parse({
        kind: 'RECIPIENT',
        key: 'CONTACT@example.invalid',
      }),
    ).toEqual({ kind: 'RECIPIENT', key: recipient });
    expect(
      documentAudienceSchema.safeParse({
        kind: 'DOMAIN',
        key: '*.example.invalid',
      }).success,
    ).toBe(false);
    expect(
      audienceMatches(
        { audience_kind: 'DOMAIN', audience_key: 'example.invalid' },
        'a@sub.example.invalid',
      ),
    ).toBe(false);
    expect(
      audienceMatches({ audience_kind: 'RECIPIENT', audience_key: recipient }),
    ).toBe(false);
  });
  it('no recupera fragmentos de otro destinatario aunque el adaptador los devuelva', async () => {
    const search = vi.fn().mockResolvedValue([
      knowledgeCandidate(1, {
        audience_kind: 'RECIPIENT',
        audience_key: 'other@example.invalid',
      }),
    ]);
    const retriever = createKnowledgeRetriever({
      configuration: async () => knowledgeConfiguration(),
      search,
      assertRevision: vi.fn(),
    });
    const result = await retriever.retrieve({
      question: '¿Cuál es el plazo de entrega?',
      intent: 'REQUEST_INFORMATION',
      recipient,
    });
    expect(result.matches).toEqual([]);
    expect(search.mock.calls[0][0].recipient).toBe(recipient);
  });
});
