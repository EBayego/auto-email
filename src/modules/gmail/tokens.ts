import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SecretValue } from '@/config/env';
import { GmailOAuthError } from './errors';

const associatedData = (
  userId: string,
  email: string,
  kind: 'refresh' | 'access',
) => Buffer.from(`auto-email:gmail:${kind}:v1\0${userId}\0${email}`, 'utf8');

function keyBytes(key: SecretValue) {
  const value = key.reveal();
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
    Buffer.from(value, 'base64').toString('base64') !== value
  )
    throw new GmailOAuthError('UNAVAILABLE');
  return Buffer.from(value, 'base64');
}

export function encryptGmailRefreshToken(
  token: SecretValue,
  key: SecretValue,
  userId: string,
  email: string,
  kind: 'refresh' | 'access' = 'refresh',
): string {
  try {
    if (!token.reveal() || Buffer.byteLength(token.reveal(), 'utf8') > 8192)
      throw new Error();
    const nonce = randomBytes(12);
    const material = keyBytes(key);
    let cipher;
    try {
      cipher = createCipheriv('aes-256-gcm', material, nonce);
    } finally {
      material.fill(0);
    }
    cipher.setAAD(associatedData(userId, email, kind));
    const ciphertext = Buffer.concat([
      cipher.update(token.reveal(), 'utf8'),
      cipher.final(),
    ]);
    return `\\x${Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]).toString('hex')}`;
  } catch {
    throw new GmailOAuthError('UNAVAILABLE');
  }
}

export function decryptGmailRefreshToken(
  encrypted: string,
  key: SecretValue,
  userId: string,
  email: string,
  kind: 'refresh' | 'access' = 'refresh',
): SecretValue {
  try {
    if (
      encrypted.length % 2 !== 0 ||
      encrypted.length > 16444 ||
      !/^\\x[0-9a-f]+$/i.test(encrypted)
    )
      throw new Error();
    const bytes = Buffer.from(encrypted.slice(2), 'hex');
    if (bytes.length < 30 || bytes[0] !== 1) throw new Error();
    const material = keyBytes(key);
    let decipher;
    try {
      decipher = createDecipheriv(
        'aes-256-gcm',
        material,
        bytes.subarray(1, 13),
      );
    } finally {
      material.fill(0);
    }
    decipher.setAAD(associatedData(userId, email, kind));
    decipher.setAuthTag(bytes.subarray(13, 29));
    return new SecretValue(
      Buffer.concat([
        decipher.update(bytes.subarray(29)),
        decipher.final(),
      ]).toString('utf8'),
    );
  } catch {
    throw new GmailOAuthError('UNAVAILABLE');
  }
}
