export type ProviderName = 'openai' | 'google';
export type ProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'INVALID_GRANT'
  | 'ACCESS_TOKEN_REJECTED'
  | 'RATE_LIMITED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'REQUEST_REJECTED'
  | 'INVALID_RESPONSE'
  | 'UNAVAILABLE';

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  constructor(
    provider: ProviderName,
    code: ProviderErrorCode,
    details: { httpStatus?: number; retryAfterMs?: number } = {},
  ) {
    super(`${provider}: ${code}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = code;
    this.retryable = code === 'RATE_LIMITED' || code === 'UNAVAILABLE';
    this.httpStatus = details.httpStatus;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export function providerFailure(provider: ProviderName, status?: number) {
  return new ProviderError(
    provider,
    status === 401 || status === 403
      ? 'AUTHENTICATION_FAILED'
      : status === 429
        ? 'RATE_LIMITED'
        : status && status >= 400 && status < 500 && status !== 408
          ? 'REQUEST_REJECTED'
          : 'UNAVAILABLE',
  );
}
