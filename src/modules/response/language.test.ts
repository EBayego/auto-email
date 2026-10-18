import { describe, expect, it } from 'vitest';
import { detectReplyLanguage } from './language';
describe('control de idioma de alta evidencia para la PoC', () => {
  it.each([
    ['Hola, ¿puedes confirmarme que has recibido este correo? Gracias.', 'es'],
    [
      'Buenos días, confirmo que he recibido tu mensaje. Gracias y un saludo.',
      'es',
    ],
    [
      'Hello, please confirm that you have received this message. Thank you.',
      'en',
    ],
    [
      'Hi, we can provide support for your project and review your message. Regards.',
      'en',
    ],
  ])('reconoce %s', (text, expected) =>
    expect(detectReplyLanguage(text)).toBe(expected),
  );
  it.each([
    'OK',
    'Hola',
    'Merci pour votre retour.',
    'The mensaje para you con this correo and gracias',
  ])('deja textos breves, otros idiomas y mezclas al verificador: %s', (text) =>
    expect(detectReplyLanguage(text)).toBeNull(),
  );
});
