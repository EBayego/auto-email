import { describe, expect, it } from 'vitest';
import { writingProfileFixture } from '../../../tests/fixtures/writing-profile';
import { parseWritingProfile, validateWritingProfile } from './writing-profile';
describe('JSON del primer perfil de escritura', () => {
  it('valida el contrato completo y devuelve una copia independiente', () => {
    const profile = writingProfileFixture();
    const result = parseWritingProfile(JSON.stringify(profile));
    expect(result).toEqual(profile);
    result.vocabulary.push('Gracias');
    expect(profile.vocabulary).not.toContain('Gracias');
  });
  it.each([
    { schema_version: 2 },
    { language: 'español' },
    { formality: 'very-formal' },
    { average_length: 'tiny' },
    { uses_emojis: 'yes' },
    { preferred_greetings: ['Hola', 'Hola'] },
    { preferred_closings: ['Saludos a private@example.invalid'] },
    {
      vocabulary: [
        'una frase excesivamente larga para conservar en memoria de estilo',
      ],
    },
    { structure: 'El proyecto ABC cuesta 500 euros' },
    { punctuation: 'Teléfono +34 123456789' },
    { style_description: 'Consulta https://example.invalid' },
    { style_description: 'a'.repeat(601) },
    { style_description: ' texto con espacios ' },
    { profile_email: 'private@example.invalid' },
    {
      preferred_greetings: Array.from({ length: 6 }, (_, i) =>
        String.fromCharCode(65 + i),
      ),
    },
  ])('rechaza datos inválidos o identificativos: %j', (extra) => {
    expect(() =>
      validateWritingProfile({ ...writingProfileFixture(), ...extra }),
    ).toThrow('INVALID_PROFILE');
  });
  it.each([null, [], {}, 'plain text'])(
    'rechaza entradas incompletas: %j',
    (input) => {
      expect(() => validateWritingProfile(input)).toThrow('INVALID_PROFILE');
    },
  );
  it('rechaza JSON roto, campos ausentes y respuestas desmesuradas sin exponerlas', () => {
    for (const text of ['private-provider-body', '{', 'x'.repeat(8193)])
      expect(() => parseWritingProfile(text)).toThrow('INVALID_PROFILE');
    const partial: Record<string, unknown> = { ...writingProfileFixture() };
    delete partial.language;
    expect(() => validateWritingProfile(partial)).toThrow('INVALID_PROFILE');
  });
});
