import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from './page';
import PrivacyPage from './privacy/page';
import { validationOffer } from '@/modules/commercial/offer';

describe('MAIL-068 páginas públicas para Google OAuth', () => {
  it('explica Gmail, los borradores, los proveedores y el estado de pruebas sin afirmar verificación', () => {
    const html = renderToStaticMarkup(<HomePage />);
    for (const text of [
      'Auto Email',
      'Gmail',
      'OpenAI',
      'borradores',
      'Acceso en pruebas',
      'pendiente de la verificación de Google',
    ])
      expect(html).toContain(text);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('no envía correos automáticamente');
    expect(html).not.toMatch(/Google Verified|verificada por Google/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('mantiene pública la privacidad y muestra que falta la revisión legal', () => {
    vi.stubEnv('PRIVACY_OPERATOR_NAME', '');
    vi.stubEnv('PRIVACY_REVIEW_APPROVED', 'false');
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain('Información pendiente de completar');
    expect(html).toContain('Limited Use');
    expect(html).toContain('gmail.compose permite técnicamente enviar');
    expect(html).toContain('OpenAI');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('explica el precio y los límites sin abrir una contratación ni afirmar resultados del piloto', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain(`${validationOffer.priceEur} €`);
    expect(html).toContain('Sin renovación automática');
    expect(html).toContain('Contratación y cobro todavía no disponibles');
    expect(html).toContain('Configuración inicial de hasta 10 borradores');
    expect(html).toContain('los impuestos aplicables');
    expect(html).not.toMatch(
      /href="(?:[^"]*(?:stripe|checkout|pago|comprar))|<form|<iframe|ahorro garantizado|clientes satisfechos/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('identifica la simulación como ficticia y permite conocer el producto sin sesión ni formularios', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('Demostración con datos ficticios');
    expect(html).toContain('no llama a una IA');
    expect(html).toContain('id="demo"');
    expect(html).toContain('id="oferta"');
    expect(html).not.toContain('name="email"');
    expect(fetch).not.toHaveBeenCalled();
  });
});
