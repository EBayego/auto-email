import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountDataControls } from './account-data-controls';
import { DisconnectGmail } from '../disconnect-gmail';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
describe('MAIL-055 controles de datos', () => {
  it('solo ofrece iniciar confirmaciones; no envía una eliminación al entrar en Ajustes', () => {
    const html = renderToStaticMarkup(
      <AccountDataControls email="owner@example.invalid" />,
    );
    expect(html).toContain('Borrar perfil y preferencias de escritura');
    expect(html).toContain('Eliminar mi cuenta y sus datos');
    expect(html).not.toContain('Sí, eliminar mi cuenta');
    expect(html).not.toContain('<form');
  });
  it('desconectar requiere un paso previo de confirmación', () => {
    const html = renderToStaticMarkup(<DisconnectGmail />);
    expect(html).toContain('Desconectar Gmail y revocar acceso');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('confirmed');
  });
});
