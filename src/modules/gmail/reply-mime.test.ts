import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import { buildReplyMime } from './reply-mime';
const fixture = () => ({
  from: 'owner@example.invalid',
  target: {
    to: { name: 'Nombre ignorado', address: 'contact@example.invalid' },
    subject: 'Re: Confirmación de recepción 📩 '.repeat(6),
    inReplyTo: '<target@example.invalid>',
    references: ['<previous@example.invalid>', '<target@example.invalid>'],
  },
  bodyText:
    'Buenos días,\n\nConfirmo que he recibido tu correo.\n\nGracias y un saludo.',
  attemptId: '10000000-0000-4000-8000-000000000021',
  now: new Date('2026-10-18T13:00:00Z'),
});
describe('MIME de una respuesta con Unicode', () => {
  it('se decodifica como MIME válido, conserva asunto, destinatario único, respuesta y cuerpo', async () => {
    const input = fixture();
    const result = buildReplyMime(input);
    expect(result.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = Buffer.from(result.raw, 'base64url');
    const email = await PostalMime.parse(bytes);
    expect(email.from?.address).toBe(input.from);
    expect(email.to).toEqual([{ address: input.target.to.address, name: '' }]);
    expect(email.cc).toBeUndefined();
    expect(email.bcc).toBeUndefined();
    expect(email.subject).toBe(input.target.subject);
    expect(email.inReplyTo).toBe(input.target.inReplyTo);
    expect(email.references).toBe(input.target.references.join(' '));
    expect(email.text?.replace(/\r\n/g, '\n').trim()).toBe(input.bodyText);
    expect(email.attachments).toHaveLength(0);
    expect(
      bytes
        .toString()
        .split('\r\n')
        .every((line) => Buffer.byteLength(line) <= 998),
    ).toBe(true);
    expect(bytes.toString().replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
  it('admite un asunto vacío y añade el objetivo al final de References sin duplicarlo', async () => {
    const input = fixture();
    input.target.subject = '';
    input.target.references.reverse();
    const result = buildReplyMime(input);
    expect(result.subject).toBe('');
    expect(result.references).toEqual([
      '<previous@example.invalid>',
      '<target@example.invalid>',
    ]);
    expect(
      (
        await PostalMime.parse(Buffer.from(result.raw, 'base64url'))
      ).text?.trim(),
    ).toBe(input.bodyText);
  });
  it.each([
    'bad@example.invalid\r\nBcc: victim@example.invalid',
    'a@example.invalid,b@example.invalid',
    'Nombre <a@example.invalid>',
  ])('rechaza destinatarios inseguros: %s', (address) => {
    const input = fixture();
    input.target.to.address = address;
    expect(() => buildReplyMime(input)).toThrow('INVALID_INPUT');
  });
  it.each([
    { from: 'a@example.invalid\nTo: other@example.invalid' },
    { bodyText: '' },
    { bodyText: 'x'.repeat(6001) },
    { attemptId: 'bad' },
    { now: new Date(NaN) },
  ])('rechaza entrada inválida antes de construir MIME: %o', (extra) =>
    expect(() => buildReplyMime({ ...fixture(), ...extra })).toThrow(
      'INVALID_INPUT',
    ),
  );
  it('rechaza inyección de cabeceras y referencias excesivas sin truncarlas', () => {
    for (const target of [
      { subject: 'Hola\r\nBcc: victim@example.invalid' },
      { inReplyTo: '<x@example.invalid>\r\nBcc: victim@example.invalid' },
      { references: ['<x@x@x>'] },
      { references: Array(101).fill('<x@example.invalid>') },
      {
        references: Array.from(
          { length: 20 },
          (_, i) => `<${i}${'x'.repeat(800)}@example.invalid>`,
        ),
      },
    ])
      expect(() =>
        buildReplyMime({
          ...fixture(),
          target: { ...fixture().target, ...target },
        }),
      ).toThrow('INVALID_INPUT');
  });
});
