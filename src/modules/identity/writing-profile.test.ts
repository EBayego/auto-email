import { describe, expect, it } from 'vitest';
import {
  writingProfileFixture,
  legacyWritingProfileFixture,
} from '../../../tests/fixtures/writing-profile';
import {
  parseWritingProfile,
  validateWritingProfile,
  validateCurrentWritingProfile,
  writingProfileSchema,
} from './writing-profile';
describe('MAIL-024, contrato versionado de estilo con Zod', () => {
  it('valida el contrato completo y devuelve una copia independiente', () => {
    const profile = writingProfileFixture();
    const result = parseWritingProfile(JSON.stringify(profile));
    expect(result).toEqual(profile);
    result.vocabulary.push('Gracias');
    expect(profile.vocabulary).not.toContain('Gracias');
  });
  it.each([
    { schema_version: 3 },
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
    { form_of_address: 'best_friend' },
    {
      tone: {
        warmth: 'warm',
        directness: 'direct',
        personality: 'extroverted',
      },
    },
    { tone: { warmth: 'warm' } },
    {
      structure_traits: {
        sentence_length: 'tiny',
        paragraph_length: 'short',
        lists: 'none',
      },
    },
    {
      punctuation_traits: {
        exclamations: true,
        ellipses: 'none',
        semicolons: 'none',
      },
    },
    {
      punctuation_traits: {
        exclamations: 'occasional',
        ellipses: 'none',
        semicolons: null,
      },
    },
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
    for (const text of ['private-provider-body', '{', 'x'.repeat(16385)])
      expect(() => parseWritingProfile(text)).toThrow('INVALID_PROFILE');
    const partial: Record<string, unknown> = { ...writingProfileFixture() };
    delete partial.language;
    expect(() => validateWritingProfile(partial)).toThrow('INVALID_PROFILE');
  });
  it('lee perfiles anteriores sin inventar campos y exige la versión actual para nuevas generaciones', () => {
    const legacy = legacyWritingProfileFixture();
    expect(parseWritingProfile(JSON.stringify(legacy))).toEqual(legacy);
    expect(() => validateCurrentWritingProfile(legacy)).toThrow(
      'INVALID_PROFILE',
    );
    expect(validateCurrentWritingProfile(writingProfileFixture())).toEqual(
      writingProfileFixture(),
    );
  });
  it('admite falta de evidencia explícita sin aceptar objetos incompletos o versiones híbridas', () => {
    const current = writingProfileFixture();
    current.form_of_address = 'unknown';
    current.tone = { warmth: 'unknown', directness: 'mixed' };
    current.structure_traits = {
      sentence_length: 'unknown',
      paragraph_length: 'mixed',
      lists: 'unknown',
    };
    expect(validateWritingProfile(current)).toEqual(current);
    expect(() =>
      validateWritingProfile({ ...current, schema_version: 1 }),
    ).toThrow('INVALID_PROFILE');
  });
  it('publica para OpenAI un objeto completo y estricto con las mismas características', () => {
    expect(writingProfileSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        schema_version: { const: 2 },
        tone: {
          type: 'object',
          required: ['warmth', 'directness'],
          additionalProperties: false,
        },
        structure_traits: { additionalProperties: false },
        punctuation_traits: { additionalProperties: false },
      },
    });
    expect(writingProfileSchema.required).toEqual(
      Object.keys(writingProfileFixture()),
    );
  });
  it('no expone detalles de Zod ni textos del proveedor en los errores', () => {
    try {
      validateWritingProfile({
        ...writingProfileFixture(),
        style_description: 'private@example.invalid',
      });
      expect.fail('El perfil inválido debe rechazarse');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'WritingProfileError',
        message: 'INVALID_PROFILE',
      });
      expect(JSON.stringify(error)).not.toMatch(/private|issues|ZodError/);
    }
  });
});
