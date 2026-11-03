import { AuthError, ServerError } from '@azure/msal-node';
import { DataAccessError } from '@/db/errors';
import { PrivacyError } from '@/modules/privacy/notice';
import { SharePointError } from './contracts';

import {
  microsoftOAuthStatus,
  type MicrosoftOAuthStatus,
} from './oauth-status';

export function microsoftOAuthErrorCode(error: unknown): MicrosoftOAuthStatus {
  if (error instanceof SharePointError || error instanceof PrivacyError)
    return error.code === 'CONNECTED'
      ? 'MICROSOFT_UNAVAILABLE'
      : microsoftOAuthStatus(error.code);
  if (error instanceof DataAccessError)
    return error.code === 'UNAUTHENTICATED'
      ? 'SESSION_REQUIRED'
      : 'CONNECTOR_UNAVAILABLE';
  if (error instanceof ServerError) {
    if (error.errorNo === '7000222') return 'MICROSOFT_CLIENT_SECRET_EXPIRED';
    if (['700016', '700011'].includes(error.errorNo ?? ''))
      return 'MICROSOFT_APPLICATION_NOT_FOUND';
    if (
      ['7000215', '7000218', '70002', '700025'].includes(error.errorNo ?? '') ||
      error.errorCode === 'invalid_client'
    )
      return 'MICROSOFT_CLIENT_SECRET_INVALID';
    if (
      ['consent_required', 'interaction_required', 'access_denied'].includes(
        error.errorCode,
      )
    )
      return 'MICROSOFT_CONSENT_REQUIRED';
    if (error.errorCode === 'invalid_grant') return 'MICROSOFT_CODE_REJECTED';
  }
  if (error instanceof AuthError && error.errorCode === 'nonce_mismatch')
    return 'MICROSOFT_IDENTITY_REJECTED';
  return 'MICROSOFT_UNAVAILABLE';
}
