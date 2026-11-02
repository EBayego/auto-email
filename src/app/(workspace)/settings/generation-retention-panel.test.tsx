import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerationRetentionPanel } from './generation-retention-panel';
const accountId = crypto.randomUUID();
describe('EPIC-09 permiso visible y opcional de comparación', () => {
  it('empieza desactivado y requiere autorización explícita antes de conservar', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const html = renderToStaticMarkup(
      <GenerationRetentionPanel
        accountId={accountId}
        initial={{
          accountId,
          enabled: false,
          retentionHours: null,
          noticeVersion: null,
          authorizedAt: null,
        }}
      />,
    );
    expect(html).toContain('Desactivado');
    expect(html).toContain('disabled="">Autorizar comparación');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('personales y sensibles');
    expect(html).toContain('cinco minutos');
    expect(html).toContain('No se guardan copias retroactivas');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('permite retirar el permiso activo y explica la independencia de la autorización automática', () => {
    const html = renderToStaticMarkup(
      <GenerationRetentionPanel
        accountId={accountId}
        initial={{
          accountId,
          enabled: true,
          retentionHours: 24,
          noticeVersion: 'mail056-v1',
          authorizedAt: '2026-10-31T12:00:00Z',
        }}
      />,
    );
    expect(html).toContain('Retirar permiso y purgar copias');
    expect(html).toContain('plazo máximo: 24 horas');
    expect(html).toContain('otro permiso en Mi estilo');
    expect(html).toContain('Actualizar plazo autorizado');
  });
});
