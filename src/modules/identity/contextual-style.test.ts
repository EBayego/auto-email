import { describe, expect, it } from 'vitest';
import {
  groupContextualSamples,
  normalizeStyleScope,
  relationshipFor,
  styleVariations,
  validateRelationshipRule,
} from './contextual-style';
import type { StyleSampleMessage } from './sent-sample';
import { writingProfileFixture } from '../../../tests/fixtures/writing-profile';

const messages = (
  count: number,
  address = (i: number) => `person${i % 3}@company.invalid`,
): StyleSampleMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `sent${i}`,
    threadId: `thread${i % 5}`,
    authoredText: `Una respuesta personal sobre la propuesta ${i}.`,
    wordCount: 20,
    length: 'short',
    kind: 'reply',
    context: {
      recipient: address(i),
      sentAt: `2026-08-${String(1 + (i % 8)).padStart(2, '0')}T12:00:00Z`,
    },
  }));
describe('MAIL-025, agrupación de evidencia y relaciones explícitas', () => {
  it('agrupa contactos y dominios solo con suficiente diversidad y no inventa categorías', () => {
    const groups = groupContextualSamples(messages(30));
    expect(groups.filter((g) => g.scope.kind === 'RECIPIENT')).toHaveLength(3);
    expect(groups.find((g) => g.scope.kind === 'DOMAIN')).toMatchObject({
      scope: { key: 'company.invalid' },
      evidence: { threads: 5, recipients: 3, days: 8, words: 600 },
    });
    expect(groups.some((g) => g.scope.kind === 'RELATIONSHIP')).toBe(false);
  });
  it.each(['few', 'thread', 'day', 'words', 'missing', 'duplicate'])(
    'mantiene el respaldo general para evidencia insuficiente: %s',
    (reason) => {
      let sample = messages(
        reason === 'few' ? 9 : 10,
        () => 'person@company.invalid',
      );
      if (reason === 'thread')
        sample = sample.map((m) => ({ ...m, threadId: 'same' }));
      if (reason === 'day')
        sample = sample.map((m) => ({
          ...m,
          context: { ...m.context!, sentAt: '2026-08-01T12:00:00Z' },
        }));
      if (reason === 'words')
        sample = sample.map((m) => ({ ...m, wordCount: 8 }));
      if (reason === 'missing')
        sample = sample.map((m) => ({ ...m, context: undefined }));
      if (reason === 'duplicate')
        sample = sample.map((m) => ({ ...m, id: 'same' }));
      expect(groupContextualSamples(sample)).toEqual([]);
    },
  );
  it('un solo contacto no representa un dominio ni una categoría', () => {
    const groups = groupContextualSamples(
      messages(20, () => 'person@company.invalid'),
      [{ kind: 'DOMAIN', key: 'company.invalid', category: 'CLIENT' }],
    );
    expect(groups.map((g) => g.scope.kind)).toEqual(['RECIPIENT']);
  });
  it('distingue clientes y compañeros solo mediante asignaciones del titular', () => {
    const groups = groupContextualSamples(
      messages(40, (i) => `${i % 4}@company.invalid`),
      [
        { kind: 'DOMAIN', key: 'company.invalid', category: 'CLIENT' },
        { kind: 'RECIPIENT', key: '0@company.invalid', category: 'COLLEAGUE' },
        { kind: 'RECIPIENT', key: '1@company.invalid', category: 'COLLEAGUE' },
      ],
    );
    expect(
      groups
        .filter((g) => g.scope.kind === 'RELATIONSHIP')
        .map((g) => g.scope.key)
        .sort(),
    ).toEqual(['CLIENT', 'COLLEAGUE']);
    expect(
      relationshipFor('0@company.invalid', [
        { kind: 'DOMAIN', key: 'company.invalid', category: 'CLIENT' },
        { kind: 'RECIPIENT', key: '0@company.invalid', category: 'OTHER' },
      ]),
    ).toBe('OTHER');
  });
  it('no agrupa proveedores de correo compartidos como si fueran una empresa', () => {
    expect(
      groupContextualSamples(
        messages(30, (i) => `person${i % 3}@gmail.com`),
      ).every((g) => g.scope.kind === 'RECIPIENT'),
    ).toBe(true);
  });
  it.each([
    { kind: 'RELATIONSHIP', key: 'HEALTH_STATUS' },
    { kind: 'DOMAIN', key: '*.example.invalid' },
    { kind: 'RECIPIENT', key: 'person@example.invalid\nBcc: other' },
  ])('rechaza contextos no autorizados y etiquetas sensibles %j', (scope) =>
    expect(() => normalizeStyleScope(scope)).toThrow('INVALID_CONTEXT'),
  );
  it('normaliza las claves y solo compara dimensiones de escritura', () => {
    expect(
      normalizeStyleScope({ kind: 'RECIPIENT', key: 'Person@Company.Invalid' })
        .key,
    ).toBe('person@company.invalid');
    expect(() =>
      validateRelationshipRule({
        kind: 'DOMAIN',
        key: 'company.invalid',
        category: 'sensitive' as never,
      }),
    ).toThrow('INVALID_CONTEXT');
    const general = writingProfileFixture();
    expect(
      styleVariations(general, {
        ...general,
        formality: 'high',
        average_length: 'long',
        language: 'en',
      }),
    ).toEqual(['formality', 'average_length', 'language']);
  });
  it('rechaza configuración contradictoria y acota el número de grupos', () => {
    expect(() =>
      groupContextualSamples(messages(20), [
        { kind: 'DOMAIN', key: 'company.invalid', category: 'CLIENT' },
        { kind: 'DOMAIN', key: 'COMPANY.INVALID', category: 'OTHER' },
      ]),
    ).toThrow('INVALID_CONTEXT');
    expect(
      groupContextualSamples(
        messages(200, (i) => `person${i % 20}@company.invalid`),
      ).length,
    ).toBeLessThanOrEqual(12);
  });
});
