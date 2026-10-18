import { describe, expect, it } from 'vitest';
import { SecretValue } from '@/config/env';
import { decryptGmailRefreshToken, encryptGmailRefreshToken } from './tokens';

const key = new SecretValue(Buffer.alloc(32, 11).toString('base64'));
const token = new SecretValue('private-refresh-token');
const owner = '00000000-0000-4000-8000-000000000012';
const email = 'mailbox@example.invalid';

describe('cifrado de credenciales Gmail', () => {
  it('usa un nonce distinto y recupera el valor sin exponerlo en representaciones', () => {
    const a = encryptGmailRefreshToken(token, key, owner, email);
    const b = encryptGmailRefreshToken(token, key, owner, email);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\\x01[0-9a-f]+$/);
    const recovered = decryptGmailRefreshToken(a, key, owner, email);
    expect(recovered.reveal()).toBe(token.reveal());
    expect(JSON.stringify(recovered)).toBe('"[REDACTED]"');
  });

  it('rechaza corrupción, versión desconocida, clave incorrecta y trasplante a otro usuario o buzón', () => {
    const encrypted = encryptGmailRefreshToken(token, key, owner, email);
    const modified =
      encrypted.slice(0, -2) + (encrypted.endsWith('00') ? 'ff' : '00');
    for (const value of [
      'bad',
      '\\x01',
      '\\x02' + encrypted.slice(4),
      modified,
    ])
      expect(() => decryptGmailRefreshToken(value, key, owner, email)).toThrow(
        'UNAVAILABLE',
      );
    expect(() =>
      decryptGmailRefreshToken(encrypted, key, 'another-user', email),
    ).toThrow('UNAVAILABLE');
    expect(() =>
      decryptGmailRefreshToken(
        encrypted,
        key,
        owner,
        'another@example.invalid',
      ),
    ).toThrow('UNAVAILABLE');
    expect(() =>
      decryptGmailRefreshToken(
        encrypted,
        new SecretValue(Buffer.alloc(32, 12).toString('base64')),
        owner,
        email,
      ),
    ).toThrow('UNAVAILABLE');
  });
  it('separa criptográficamente los access tokens y refresh tokens', () => {
    const encrypted = encryptGmailRefreshToken(
      token,
      key,
      owner,
      email,
      'access',
    );
    expect(
      decryptGmailRefreshToken(encrypted, key, owner, email, 'access').reveal(),
    ).toBe(token.reveal());
    expect(() =>
      decryptGmailRefreshToken(encrypted, key, owner, email),
    ).toThrow('UNAVAILABLE');
  });
});
