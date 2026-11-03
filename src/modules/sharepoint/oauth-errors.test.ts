import { describe, expect, it } from 'vitest';
import { AuthError, ServerError } from '@azure/msal-node';
import { DataAccessError } from '@/db/errors';
import { PrivacyError } from '@/modules/privacy/notice';
import { SharePointError } from './contracts';
import { microsoftOAuthErrorCode } from './oauth-errors';

describe('diagnóstico público de errores OAuth Microsoft', () => {
  it.each([
    [
      new AuthError('nonce_mismatch', 'private-correlation', 'private-token'),
      'MICROSOFT_IDENTITY_REJECTED',
    ],
    [
      new ServerError('invalid_client', '', 'private-secret', '', '7000215'),
      'MICROSOFT_CLIENT_SECRET_INVALID',
    ],
    [
      new ServerError('invalid_client', '', 'private-secret', '', '7000222'),
      'MICROSOFT_CLIENT_SECRET_EXPIRED',
    ],
    [
      new ServerError('invalid_client', '', 'private-tenant', '', '700016'),
      'MICROSOFT_APPLICATION_NOT_FOUND',
    ],
    [
      new ServerError('invalid_grant', '', 'private-code'),
      'MICROSOFT_CODE_REJECTED',
    ],
    [new ServerError('consent_required', ''), 'MICROSOFT_CONSENT_REQUIRED'],
    [new DataAccessError('UNAUTHENTICATED'), 'SESSION_REQUIRED'],
    [new DataAccessError('UNAVAILABLE'), 'CONNECTOR_UNAVAILABLE'],
    [new PrivacyError('PRIVACY_CONSENT_REQUIRED'), 'PRIVACY_CONSENT_REQUIRED'],
    [new SharePointError('INVALID_OAUTH_STATE'), 'INVALID_OAUTH_STATE'],
    [new SharePointError('private-token'), 'MICROSOFT_UNAVAILABLE'],
    [new Error('private-token'), 'MICROSOFT_UNAVAILABLE'],
  ])('normaliza %s sin exponer mensajes del proveedor', (error, code) => {
    expect(microsoftOAuthErrorCode(error)).toBe(code);
  });
});
