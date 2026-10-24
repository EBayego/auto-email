import { describe, expect, it, vi } from 'vitest';
import { routeSources, searchWithSourcePlan } from './route-sources';
import {
  sourceOperationSchema,
  type SourceConfiguration,
  type SourceContext,
  type SourceRule,
} from './sources';

const a = '00000000-0000-4000-8000-000000000001',
  b = '00000000-0000-4000-8000-000000000002',
  c = '00000000-0000-4000-8000-000000000003';
const rule: SourceRule = {
  id: 'rule1',
  title: 'Precios',
  intent: 'REQUEST_INFORMATION',
  terms: ['precio', 'tarifas'],
  priority: 100,
  enabled: true,
  allowEmailHistory: false,
  primarySourceIds: [a],
  fallbackSourceIds: [b],
  excludedSourceIds: [c],
};
const config = (): SourceConfiguration => ({
  allowPartialDrafts: false,
  revision: 'snapshot',
  sources: [
    { id: a, title: 'Tarifas', priority: 20, enabled: true },
    { id: b, title: 'Respaldo', priority: 10, enabled: true },
    { id: c, title: 'Antiguos', priority: 0, enabled: true },
  ],
  rules: [{ ...rule }],
});
const context: SourceContext = {
  query: '¿Cuál es el precio vigente?',
  intent: 'REQUEST_INFORMATION',
  topics: [],
};
describe('MAIL-038 selección determinista y permisos de fuentes', () => {
  it('elige principales y respaldo y prohíbe hechos del historial', () => {
    expect(routeSources(config(), context)).toMatchObject({
      primarySources: [{ id: a }],
      fallbackSources: [{ id: b }],
      excludedSourceIds: [c],
      allowEmailHistory: false,
      reason: 'MATCHED_RULES',
      revision: 'snapshot',
    });
  });
  it.each(['precio', 'PRÉCIO', 'precio?', 'una consulta sobre precio vigente'])(
    'normaliza palabras y acentos: %s',
    (query) => {
      expect(
        routeSources(config(), { ...context, query }).matchedRuleIds,
      ).toEqual(['rule1']);
    },
  );
  it('no hace coincidir subcadenas ni cambia la intención', () => {
    expect(
      routeSources(config(), { ...context, query: 'aprecio tu ayuda' }).reason,
    ).toBe('NO_MATCHING_RULE');
    expect(
      routeSources(config(), { ...context, intent: 'COMPLAINT' }).reason,
    ).toBe('NO_MATCHING_RULE');
  });
  it('admite un tema explícito y reglas de toda una intención', () => {
    expect(
      routeSources(config(), {
        ...context,
        query: '¿Cuánto cuesta?',
        topics: ['tarifas'],
      }).reason,
    ).toBe('MATCHED_RULES');
    const input = config();
    input.rules[0].terms = [];
    expect(
      routeSources(input, { ...context, query: 'Pregunta general' }).reason,
    ).toBe('MATCHED_RULES');
  });
  it('sin regla no autoriza ninguna fuente ni historial', () => {
    const input = config();
    input.rules = [];
    expect(routeSources(input, context)).toMatchObject({
      primarySources: [],
      fallbackSources: [],
      allowEmailHistory: false,
      reason: 'NO_MATCHING_RULE',
    });
  });
  it('las exclusiones y prohibiciones prevalecen frente a otra regla de mayor prioridad', () => {
    const input = config();
    input.rules.push({
      ...rule,
      id: 'rule2',
      priority: 0,
      allowEmailHistory: true,
      primarySourceIds: [c, b],
      fallbackSourceIds: [],
      excludedSourceIds: [a],
    });
    const plan = routeSources(input, context);
    expect(plan.primarySources.map((s) => s.id)).toEqual([b]);
    expect(plan.fallbackSources).toEqual([]);
    expect(plan.excludedSourceIds).toEqual([a, c]);
    expect(plan.allowEmailHistory).toBe(false);
  });
  it('ordena fuentes por prioridad y elimina duplicados', () => {
    const input = config();
    input.rules[0].primarySourceIds = [a, b];
    input.rules.push({ ...input.rules[0], id: 'rule2' });
    expect(
      routeSources(input, context).primarySources.map((s) => s.id),
    ).toEqual([b, a]);
  });
  it('omite fuentes y reglas desactivadas sin ampliar la búsqueda', () => {
    const input = config();
    input.sources.forEach((s) => (s.enabled = false));
    expect(routeSources(input, context)).toMatchObject({
      reason: 'NO_AUTHORIZED_SOURCES',
      primarySources: [],
      fallbackSources: [],
    });
    input.rules[0].enabled = false;
    expect(routeSources(input, context).reason).toBe('NO_MATCHING_RULE');
  });
  it('consulta respaldo solo cuando no hay coincidencias principales', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['evidencia']);
    expect(
      await searchWithSourcePlan(routeSources(config(), context), search),
    ).toEqual({ matches: ['evidencia'], usedFallback: true });
    expect(search.mock.calls).toEqual([[[a]], [[b]]]);
    search.mockClear().mockResolvedValue(['principal']);
    expect(
      (await searchWithSourcePlan(routeSources(config(), context), search))
        .usedFallback,
    ).toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('un fallo de la búsqueda no concede permiso a otras fuentes', async () => {
    const search = vi.fn().mockRejectedValue(new Error('UNAVAILABLE'));
    await expect(
      searchWithSourcePlan(routeSources(config(), context), search),
    ).rejects.toThrow('UNAVAILABLE');
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('no ejecuta búsquedas sin fuentes autorizadas', async () => {
    const input = config();
    input.rules = [];
    const search = vi.fn();
    expect(
      await searchWithSourcePlan(routeSources(input, context), search),
    ).toEqual({ matches: [], usedFallback: false });
    expect(search).not.toHaveBeenCalled();
  });
  it('valida operaciones estrictas y rechaza duplicados entre roles y propietarios enviados por cliente', () => {
    const input = {
      action: 'save_rule',
      title: 'Precios',
      intent: '*',
      terms: ['precio'],
      priority: 10,
      enabled: true,
      allowEmailHistory: false,
      primarySourceIds: [a],
      fallbackSourceIds: [b],
      excludedSourceIds: [c],
    };
    expect(sourceOperationSchema.safeParse(input).success).toBe(true);
    expect(
      sourceOperationSchema.safeParse({ ...input, fallbackSourceIds: [a] })
        .success,
    ).toBe(false);
    expect(
      sourceOperationSchema.safeParse({ ...input, userId: b }).success,
    ).toBe(false);
    expect(
      sourceOperationSchema.safeParse({ ...input, primarySourceIds: [] })
        .success,
    ).toBe(false);
  });
});
