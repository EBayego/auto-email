import { describe, expect, it } from 'vitest';
import { readyResponse } from '../../../tests/fixtures/responses';
import { parseGeneratedResponse, parseResponseVerification } from './schema';
describe('salida estructurada de respuestas', () => {
  it('valida una respuesta completa y la abstención sin cuerpo', () => {
    expect(parseGeneratedResponse(JSON.stringify(readyResponse()))).toEqual(
      readyResponse(),
    );
    expect(
      parseGeneratedResponse(
        JSON.stringify({
          ...readyResponse(),
          status: 'INSUFFICIENT_CONTEXT',
          bodyText: null,
          missingInformation: ['Tarifa vigente'],
        }),
      ).status,
    ).toBe('INSUFFICIENT_CONTEXT');
  });
  it.each([
    { status: 'SEND' },
    { bodyText: null },
    { bodyText: '' },
    { language: 'español' },
    { missingInformation: ['Dato pendiente'] },
    { warnings: ['HIGH_RISK'] },
    { to: 'attacker@example.invalid' },
    { bodyText: 'Hola, el precio es [PRECIO].' },
    { bodyText: '<p>Respuesta HTML</p>' },
    { bodyText: 'To: attacker@example.invalid\nTexto' },
    { bodyText: 'a'.repeat(6001) },
    { evidence: [{ messageIndex: 25, quote: 'dato', claim: 'dato' }] },
  ])('rechaza READY inválido o incompleto: %j', (extra) => {
    expect(() =>
      parseGeneratedResponse(JSON.stringify({ ...readyResponse(), ...extra })),
    ).toThrow('INVALID_RESPONSE');
  });
  it('no permite conservar una respuesta peligrosa junto a una abstención', () => {
    expect(() =>
      parseGeneratedResponse(
        JSON.stringify({
          ...readyResponse(),
          status: 'INSUFFICIENT_CONTEXT',
          missingInformation: ['Dato pendiente'],
        }),
      ),
    ).toThrow('INVALID_RESPONSE');
    expect(() =>
      parseGeneratedResponse(
        JSON.stringify({
          ...readyResponse(),
          status: 'BLOCKED',
          bodyText: null,
        }),
      ),
    ).toThrow('INVALID_RESPONSE');
  });
  it('detecta JSON roto, campos ausentes y contenido excesivo sin propagar el texto', () => {
    for (const text of ['private-provider-body', '{}', 'x'.repeat(40001)])
      expect(() => parseGeneratedResponse(text)).toThrow('INVALID_RESPONSE');
  });
  it('solo acepta una aprobación sin incidencias y rechazos con motivos', () => {
    expect(
      parseResponseVerification('{"verdict":"SUPPORTED","issues":[]}').verdict,
    ).toBe('SUPPORTED');
    expect(
      parseResponseVerification(
        '{"verdict":"INSUFFICIENT_CONTEXT","issues":["UNSUPPORTED_COMMITMENT"]}',
      ).issues,
    ).toEqual(['UNSUPPORTED_COMMITMENT']);
    for (const value of [
      { verdict: 'SUPPORTED', issues: ['MISSING_INFORMATION'] },
      { verdict: 'BLOCKED', issues: [] },
      { verdict: 'SUPPORTED', issues: [], bodyText: 'private' },
    ])
      expect(() => parseResponseVerification(JSON.stringify(value))).toThrow(
        'INVALID_RESPONSE',
      );
  });
});
