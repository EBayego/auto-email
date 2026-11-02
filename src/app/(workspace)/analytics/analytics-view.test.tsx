import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsView } from './analytics-view';
import { analyticsFixture } from '../../../../tests/fixtures/analytics';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
describe('MAIL-060 panel de métricas', () => {
  it('declara alcance, cohortes, cobertura, incertidumbre y metodología', () => {
    const html = renderToStaticMarkup(
      <AnalyticsView snapshot={analyticsFixture()} />,
    );
    for (const text of [
      'aceptación mínima',
      'Europe/Madrid',
      'Sin datos',
      'Sin tarifa registrada',
      'no se cuenta como rechazo',
      'solo los envíos comparados',
      'no incluye análisis de estilo',
      'misma duración',
      'Fórmula v1',
      'Sin estimación',
      'Ver datos diarios',
      'aria-label="Tendencia',
      'value=""',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('Ahorro simulado:');
  });
  it('presenta diferencias desfavorables sin convertirlas en mejoras', () => {
    const snapshot = analyticsFixture();
    Object.assign(snapshot.current.totals, {
      draftsCreated: 10,
      sendsConfirmed: 2,
      compared: 2,
      edited: 2,
      knownCostUsd: 0,
      meanKnownCostUsd: 0,
    });
    Object.assign(snapshot.previous.totals, {
      draftsCreated: 10,
      sendsConfirmed: 5,
      compared: 2,
      edited: 0,
    });
    const html = renderToStaticMarkup(<AnalyticsView snapshot={snapshot} />);
    expect(html).toContain('-30 puntos porcentuales');
    expect(html).toContain('+100 puntos porcentuales');
    expect(html).toContain('0,00');
  });
});
