import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretValue } from '@/config/env';
import { SharePointError } from './contracts';

export function sealMicrosoft(value: string, key: SecretValue, owner: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key.reveal(), 'base64'),
    nonce,
  );
  cipher.setAAD(Buffer.from(`auto-email:microsoft:v1:${owner}`));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
}
export function openMicrosoft(value: string, key: SecretValue, owner: string) {
  try {
    const bytes = Buffer.from(value, 'base64');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key.reveal(), 'base64'),
      bytes.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from(`auto-email:microsoft:v1:${owner}`));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SharePointError('CREDENTIAL_UNAVAILABLE');
  }
}
