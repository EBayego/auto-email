export type GmailOAuthErrorCode =
  | 'INVALID_STATE'
  | 'CANCELLED'
  | 'AUTHORIZATION_FAILED'
  | 'MISSING_SCOPES'
  | 'REFRESH_TOKEN_REQUIRED'
  | 'INVALID_PROFILE'
  | 'ACCOUNT_MISMATCH'
  | 'ACCOUNT_IN_USE'
  | 'DISCONNECT_PENDING'
  | 'UNAVAILABLE';

export class GmailOAuthError extends Error {
  constructor(public readonly code: GmailOAuthErrorCode) {
    super(code);
    this.name = 'GmailOAuthError';
  }
}
