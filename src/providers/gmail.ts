import type {
  AccessTokenProvider,
  GmailClient,
  GmailReadResource,
  GmailQuery,
} from './contracts';
import { ProviderError, providerFailure } from './errors';

const queryKeys = new Set([
  'q',
  'pageToken',
  'maxResults',
  'labelIds',
  'format',
  'metadataHeaders',
  'includeSpamTrash',
]);

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
    try {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/${resource}`,
      );
      for (const [key, value] of Object.entries(query ?? {})) {
        if (!queryKeys.has(key))
          throw new ProviderError('google', 'REQUEST_REJECTED');
        for (const item of Array.isArray(value) ? value : [value])
          url.searchParams.append(key, String(item));
      }
      const token = await getAccessToken();
      if (!token || typeof token !== 'string' || /\s/.test(token))
        throw new ProviderError('google', 'AUTHENTICATION_FAILED');
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
      if (!response.ok) throw providerFailure('google', response.status);
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
  return Object.freeze({
    async get(resource: GmailReadResource, query?: GmailQuery) {
      if (
        typeof resource !== 'string' ||
        !/^(?:profile|messages|messages\/[A-Za-z0-9_-]+|threads\/[A-Za-z0-9_-]+)$/.test(
          resource,
        )
      )
        throw new ProviderError('google', 'REQUEST_REJECTED');
      if (
        query?.maxResults !== undefined &&
        (!Number.isInteger(query.maxResults) ||
          Number(query.maxResults) < 1 ||
          Number(query.maxResults) > 100)
      )
        throw new ProviderError('google', 'REQUEST_REJECTED');
      return request('GET', resource, query);
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
  });
}
