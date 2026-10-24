import { describe, expect, it } from 'vitest';
import { normalizeClassifierExclusions } from './rules';

describe('exclusiones del clasificador', () => {
  it('normaliza, elimina duplicados y convierte dominios internacionalizados a ASCII', () => {
    expect(
      normalizeClassifierExclusions({
        excludedAddresses: ['Person@EXAMPLE.invalid', 'person@example.invalid'],
        excludedDomains: ['ESPAÑA.es', 'xn--espaa-rta.es'],
      }),
    ).toEqual({
      excludedAddresses: ['person@example.invalid'],
      excludedDomains: ['xn--espaa-rta.es'],
    });
  });
  it('devuelve listas vacías por defecto', () => {
    expect(normalizeClassifierExclusions()).toEqual({
      excludedAddresses: [],
      excludedDomains: [],
    });
  });
  it.each([
    '*.example.invalid',
    '.example.invalid',
    'example.invalid.',
    'bad..invalid',
    '-bad.invalid',
    'bad-.invalid',
    'bad/invalid',
    'https://example.invalid',
    'bad domain.invalid',
    'a'.repeat(64) + '.invalid',
    'example.invalid\n',
  ])('rechaza dominio inválido %s', (domain) => {
    expect(() =>
      normalizeClassifierExclusions({ excludedDomains: [domain] }),
    ).toThrow('INVALID_INPUT');
  });
  it.each([
    'Name <person@example.invalid>',
    'bad@@example.invalid',
    'person@example.invalid\n',
    'person@-example.invalid',
    'person example@example.invalid',
  ])('rechaza dirección inválida %s', (address) => {
    expect(() =>
      normalizeClassifierExclusions({ excludedAddresses: [address] }),
    ).toThrow('INVALID_INPUT');
  });
  it('rechaza configuraciones inesperadas y listas excesivas', () => {
    expect(() =>
      normalizeClassifierExclusions({
        excludedDomains: Array(101).fill('example.invalid'),
      }),
    ).toThrow('INVALID_INPUT');
    expect(() =>
      normalizeClassifierExclusions({ other: 'example.invalid' } as never),
    ).toThrow('INVALID_INPUT');
    expect(() => normalizeClassifierExclusions(null as never)).toThrow(
      'INVALID_INPUT',
    );
  });
});
