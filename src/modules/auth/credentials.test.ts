import { describe, expect, it } from 'vitest';
import { readCredentials } from './credentials';

function form(email: string, password: string) {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return data;
}

describe('credenciales', () => {
  it('normaliza el correo sin alterar la contraseña', () => {
    expect(
      readCredentials(form('  PERSON@EXAMPLE.COM ', ' password '), true),
    ).toEqual({ email: 'person@example.com', password: ' password ' });
  });
  it.each([
    ['invalid', 'password'],
    ['a@example.com', ''],
    ['a@example.com', 'x'.repeat(129)],
  ])('valida también en el servidor', (email, password) => {
    expect(readCredentials(form(email, password), false)).toBeNull();
  });
  it('exige la longitud mínima al registrarse sin impedir acceder a cuentas anteriores', () => {
    expect(readCredentials(form('a@example.com', 'short'), true)).toBeNull();
    expect(
      readCredentials(form('a@example.com', 'short'), false),
    ).not.toBeNull();
  });
  it('rechaza campos ausentes y archivos en lugar de credenciales', () => {
    expect(readCredentials(new FormData(), false)).toBeNull();
    const data = form('a@example.com', 'password');
    data.set('password', new Blob(['password']));
    expect(readCredentials(data, false)).toBeNull();
  });
});
