import type {
  AccessTokenProvider,
  GmailClient,
  GmailReadResource,
  GmailQuery,
  GmailTransport,
} from './contracts';
import { ProviderError, providerFailure } from './errors';
import { normalizeGmailQuery, withMessageQueries } from './gmail-messages';

const quotaReasons = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
]);

async function gmailFailure(response: Response): Promise<ProviderError> {
  let quota = response.status === 429;
  if (response.status === 403) {
    try {
      const body = await response.json();
      quota =
        Array.isArray(body?.error?.errors) &&
        body.error.errors.some(
          (item: { reason?: unknown } | null) =>
            item &&
            typeof item.reason === 'string' &&
            quotaReasons.has(item.reason),
        );
    } catch {
      // Error bodies are optional and never form part of the public error.
    }
  }
  const code =
    response.status === 401
      ? 'ACCESS_TOKEN_REJECTED'
      : quota
        ? 'RATE_LIMITED'
        : response.status === 403
          ? 'PERMISSION_DENIED'
          : response.status === 404
            ? 'NOT_FOUND'
            : providerFailure('google', response.status).code;
  const retryAfter = response.headers.get('retry-after');
  const delay =
    retryAfter === null
      ? NaN
      : /^\d+$/.test(retryAfter)
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter) - Date.now();
  return new ProviderError('google', code, {
    httpStatus: response.status,
    ...((code === 'RATE_LIMITED' || code === 'UNAVAILABLE') &&
    Number.isSafeInteger(delay) &&
    delay >= 0
      ? { retryAfterMs: delay }
      : {}),
  });
}

export function createGmailClient(
  getAccessToken: AccessTokenProvider,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): GmailClient {
  const request = async (
    method: 'GET' | 'POST',
    resource: string,
    query?: GmailQuery,
    body?: unknown,
  ) => {
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/${resource}`,
    );
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value])
        url.searchParams.append(key, String(item));
    }
    // Credential/domain errors must survive intact so callers can reconnect.
    const token = await getAccessToken();
    if (!token || typeof token !== 'string' || /\s/.test(token))
      throw new ProviderError('google', 'AUTHENTICATION_FAILED');
    try {
      const response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) throw await gmailFailure(response);
      try {
        return await response.json();
      } catch {
        throw new ProviderError('google', 'INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw providerFailure('google');
    }
  };
  return withMessageQueries({
    async get(resource: GmailReadResource, query?: GmailQuery) {
      return request('GET', resource, normalizeGmailQuery(resource, query));
    },
    async createDraft(message: Parameters<GmailClient['createDraft']>[0]) {
      if (
        !message ||
        typeof message.raw !== 'string' ||
        !/^[A-Za-z0-9_-]+={0,2}$/.test(message.raw) ||
        (message.threadId !== undefined &&
          !/^[A-Za-z0-9_-]+$/.test(message.threadId))
      )
        throw new ProviderError('google', 'REQUEST_REJECTED');
      return request('POST', 'drafts', undefined, {
        message: {
          raw: message.raw,
          ...(message.threadId ? { threadId: message.threadId } : {}),
        },
      });
    },
  } satisfies GmailTransport);
}
