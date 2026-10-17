export type ProviderName = 'openai' | 'google';
export type ProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'REQUEST_REJECTED'
  | 'INVALID_RESPONSE'
  | 'UNAVAILABLE';

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  constructor(provider: ProviderName, code: ProviderErrorCode) {
    super(`${provider}: ${code}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = code;
    this.retryable = code === 'RATE_LIMITED' || code === 'UNAVAILABLE';
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
