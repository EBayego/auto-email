import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MicrosoftConnectionNotice } from './microsoft-connection-notice';
import { SharePointPanel } from './sharepoint-panel';

describe('estado visible del retorno de Microsoft', () => {
  it('muestra el error desde el HTML inicial, sin esperar a cargar conexiones', () => {
    const html = renderToStaticMarkup(
      <SharePointPanel oauthResult="MICROSOFT_UNAVAILABLE" />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('form-error');
    expect(html).toContain('No se ha completado la vinculación con Microsoft');
    expect(html).toContain('MICROSOFT_UNAVAILABLE');
  });
  it('distingue una conexión completada y ofrece el siguiente paso', () => {
    const html = renderToStaticMarkup(
      <MicrosoftConnectionNotice result="CONNECTED" />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Cuenta Microsoft vinculada correctamente');
    expect(html).toContain('añadir una carpeta');
    expect(html).not.toContain('role="alert"');
  });
  it('ofrece la acción de privacidad y no refleja códigos arbitrarios de la URL', () => {
    expect(
      renderToStaticMarkup(
        <MicrosoftConnectionNotice result="PRIVACY_CONSENT_REQUIRED" />,
      ),
    ).toContain('href="/privacy-consent"');
    const html = renderToStaticMarkup(
      <MicrosoftConnectionNotice result="private-user-input" />,
    );
    expect(html).not.toContain('private-user-input');
    expect(html).toContain('MICROSOFT_UNAVAILABLE');
    expect(renderToStaticMarkup(<MicrosoftConnectionNotice />)).toBe('');
  });
});
