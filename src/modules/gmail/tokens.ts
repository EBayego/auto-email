import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SecretValue } from '@/config/env';
import { GmailOAuthError } from './errors';

const associatedData = (
  userId: string,
  email: string,
  kind: 'refresh' | 'access',
) => Buffer.from(`auto-email:gmail:${kind}:v1\0${userId}\0${email}`, 'utf8');

export function encryptGmailRefreshToken(
  token: SecretValue,
  key: SecretValue,
  userId: string,
  email: string,
  kind: 'refresh' | 'access' = 'refresh',
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key.reveal(), 'base64'),
    nonce,
  );
  cipher.setAAD(associatedData(userId, email, kind));
  const ciphertext = Buffer.concat([
    cipher.update(token.reveal(), 'utf8'),
    cipher.final(),
  ]);
  return `\\x${Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]).toString('hex')}`;
}

export function decryptGmailRefreshToken(
  encrypted: string,
  key: SecretValue,
  userId: string,
  email: string,
  kind: 'refresh' | 'access' = 'refresh',
): SecretValue {
  try {
    if (!/^\\x[0-9a-f]+$/i.test(encrypted)) throw new Error();
    const bytes = Buffer.from(encrypted.slice(2), 'hex');
    if (bytes.length < 30 || bytes[0] !== 1) throw new Error();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key.reveal(), 'base64'),
      bytes.subarray(1, 13),
    );
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
