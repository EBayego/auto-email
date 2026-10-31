import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationScreen } from './automation-screen';
import { defaultResponsePolicySettings } from '@/modules/policy/settings';
const initial = {
  revision: 'a'.repeat(32),
  settings: {
    execution: {
      automationEnabled: false,
      pollIntervalSeconds: 300,
      maxDailyDrafts: 30,
    },
    processingScope: 'ALL_INCOMING' as const,
    excludedAddresses: ['avisos@example.com'],
    excludedDomains: [],
    policy: {
      ...defaultResponsePolicySettings(),
      blockedCategories: ['MEETING' as const],
      blockedTopics: ['descuentos'],
    },
  },
};
describe('MAIL-053 pantalla de automatización', () => {
  it('muestra los ajustes persistidos y controles legibles sin formularios anidados', () => {
    const html = renderToStaticMarkup(
      <AutomationScreen
        initial={initial}
        connected
        sources={{
          revision: 'r',
          allowPartialDrafts: false,
          sources: [
            {
              id: crypto.randomUUID(),
              title: 'Tarifas',
              priority: 0,
              enabled: false,
            },
          ],
          rules: [],
        }}
      />,
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('avisos@example.com');
    expect(html).toContain('descuentos');
    expect(html).toContain('Tarifas (desactivada)');
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain('Guardar configuración');
    expect(html).not.toContain('Recargar y descartar');
  });
  it('no presenta activa la automatización con Gmail desconectado ni permite perder requisitos si falla la carga de fuentes', () => {
    const html = renderToStaticMarkup(
      <AutomationScreen
        initial={{
          ...initial,
          settings: {
            ...initial.settings,
            execution: {
              ...initial.settings.execution,
              automationEnabled: true,
            },
          },
        }}
        connected={false}
        sources={null}
      />,
    );
    expect(html).toContain('Automatización en pausa');
    expect(html).toContain('La conexión Gmail debe estar activa');
    expect(html).toContain('Se conservan los requisitos actuales');
  });
});
