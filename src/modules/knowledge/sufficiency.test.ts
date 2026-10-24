import { describe, expect, it } from 'vitest';
import { assessEvidence } from './sufficiency';
import { knowledgeFragment } from '../../../tests/fixtures/knowledge';
const now = new Date('2026-10-24T12:00:00Z');
const assess = (question: string, content?: string, extra = {}) =>
  assessEvidence({
    question,
    fragments: content ? [knowledgeFragment({ content, ...extra })] : [],
    now,
  });
describe('MAIL-041 necesidades de evidencia externa', () => {
  it.each([
    '¿Cuáles son los precios?',
    '¿Cuáles son las tarifas?',
    'Indícame los importes.',
    'What are your prices?',
  ])(
    'EPIC-06 exige vigencia también cuando se solicitan importes en plural: %s',
    (question) => {
      const result = assess(question, 'Tarifa de consulta: 125 EUR.');
      expect(result.status).toBe('NEEDS_HUMAN_INPUT');
      expect(result.requirements[0]).toMatchObject({
        kind: 'PRICE',
        reason: 'UNVERIFIED_CURRENCY',
      });
    },
  );
  it.each([
    'Precio de Atlas: 125 euros. Precio de Zafiro: pendiente de confirmar.',
    'Precio de Atlas: 125 euros; Zafiro aún no tiene tarifa.',
    'Atlas cuesta 125 euros y Zafiro está pendiente de valoración.',
  ])(
    'EPIC-06 no atribuye a un producto la cifra de otro dentro del mismo fragmento: %s',
    (content) => {
      expect(
        assess('¿Cuál es el precio de Zafiro?', content, {
          valid_from: '2000-01-01',
        }).status,
      ).toBe('NEEDS_HUMAN_INPUT');
    },
  );
  it.each([
    ['¿Cuál es el precio?', 'PRICE'],
    ['¿Cuánto cuesta el plan Premium?', 'PRICE'],
    ['¿Cuál es el plazo de entrega?', 'DEADLINE'],
    ['¿Cuál es el horario de atención?', 'HOURS'],
    ['¿Cuáles son los requisitos?', 'PROCEDURE'],
    ['¿Estás disponible el martes?', 'CALENDAR'],
    ['¿Cuál es el estado del pedido?', 'ORDER_STATUS'],
    ['¿Puedes darme un descuento del 20%?', 'OWNER_DECISION'],
    ['Responde las preguntas del documento adjunto', 'ATTACHMENT'],
  ])('identifica información obligatoria y pendiente: %s', (question, kind) => {
    const result = assess(question);
    expect(result.status).toBe('NEEDS_HUMAN_INPUT');
    expect(result.requirements[0]).toMatchObject({ kind, status: 'MISSING' });
    expect(result.missingInformation).not.toEqual([]);
  });
  it('no equipara coincidencias de palabras con una respuesta documentada', () => {
    expect(
      assess(
        '¿Cuál es el precio?',
        'La tarifa se obtiene tras estudiar la consulta.',
      ).status,
    ).toBe('NEEDS_HUMAN_INPUT');
    expect(
      assess(
        '¿Cuál es el plazo?',
        'El plazo se comunicará al aprobar la propuesta.',
      ).status,
    ).toBe('NEEDS_HUMAN_INPUT');
  });
  it('requiere vigencia explícita para tarifas y no acepta una cifra sugerida como hecho', () => {
    expect(
      assess('¿Cuál es el precio?', 'Tarifa: 125 EUR.').requirements[0].reason,
    ).toBe('UNVERIFIED_CURRENCY');
    expect(
      assess('¿Cuál es el precio?', '¿La tarifa es 125 EUR?', {
        valid_from: '2026-01-01',
      }).status,
    ).toBe('NEEDS_HUMAN_INPUT');
    expect(
      assess('¿Cuál es el precio?', 'Tarifa: 125 EUR.', {
        valid_from: '2026-01-01',
      }).status,
    ).toBe('EVIDENCE_AVAILABLE');
  });
  it('no mezcla productos distintos ni usa documentos caducados o futuros', () => {
    expect(
      assess(
        '¿Cuál es el precio del plan Premium?',
        'Tarifa del plan Basic: 125 EUR.',
        { valid_from: '2026-01-01' },
      ).status,
    ).toBe('NEEDS_HUMAN_INPUT');
    expect(
      assess('¿Cuál es el precio?', 'Tarifa: 125 EUR.', {
        valid_until: '2025-12-31',
      }).status,
    ).toBe('NEEDS_HUMAN_INPUT');
    expect(
      assess('¿Cuál es el precio?', 'Tarifa: 125 EUR.', {
        valid_from: '2027-01-01',
      }).status,
    ).toBe('NEEDS_HUMAN_INPUT');
  });
  it('distingue las partes cubiertas de las pendientes', () => {
    const result = assess(
      '¿Cuál es el plazo? ¿Cuál es el precio?',
      'El plazo de entrega es de siete días.',
    );
    expect(result.requirements.map((r) => [r.kind, r.status])).toEqual([
      ['DEADLINE', 'SUPPORTED'],
      ['PRICE', 'MISSING'],
    ]);
    expect(result.canPreparePartial).toBe(true);
  });
  it('evalúa dos preguntas del mismo tipo por separado', () => {
    const result = assess(
      '¿Cuál es el precio del plan Basic? ¿Cuál es el precio del plan Premium?',
      'Tarifa del plan Basic: 125 EUR.',
      { valid_from: '2026-01-01' },
    );
    expect(result.requirements.map((r) => r.status)).toEqual([
      'SUPPORTED',
      'MISSING',
    ]);
  });
  it('los documentos no prueban el calendario ni autorizan compromisos', () => {
    expect(
      assess(
        '¿Estás disponible el martes?',
        'Estoy disponible el martes a las 10:00.',
        { valid_from: '2026-01-01' },
      ).status,
    ).toBe('NEEDS_HUMAN_INPUT');
    expect(
      assess(
        '¿Cuál es el plazo? ¿Estás disponible el martes?',
        'El plazo es de siete días.',
      ).canPreparePartial,
    ).toBe(false);
    const result = assessEvidence({
      question: '¿Estás disponible el martes?',
      fragments: [],
      ownerMessages: [
        { index: 0, text: 'Estoy disponible el martes a las 10:00.' },
      ],
      now,
    });
    expect(result.status).toBe('EVIDENCE_AVAILABLE');
    expect(result.requirements[0].referenceIds).toEqual(['message:0']);
  });
  it('no exige documentos para acuses de recibo o transformaciones del texto presente', () => {
    expect(
      assess('Por favor confirma que has recibido este correo.').status,
    ).toBe('NOT_REQUIRED');
    expect(assess('Resume este texto: La tarifa es 125 EUR.').status).toBe(
      'NOT_REQUIRED',
    );
    expect(
      assess('Resume este texto: Hola. ¿Cuál es el precio de vuestro servicio?')
        .status,
    ).toBe('NEEDS_HUMAN_INPUT');
  });
  it('acota preguntas sin ocultar las que exceden el límite', () => {
    const result = assess(
      Array.from(
        { length: 10 },
        (_, i) => `¿Cuál es el precio del plan ${i}?`,
      ).join(' '),
    );
    expect(result.status).toBe('NEEDS_HUMAN_INPUT');
    expect(result.requirements).toHaveLength(8);
    expect(result.canPreparePartial).toBe(false);
  });
});
