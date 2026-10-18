import type {
  GmailClient,
  GmailGetOptions,
  GmailListOptions,
  GmailMessage,
  GmailMessagePage,
  GmailMessagePart,
  GmailMessageReference,
  GmailQuery,
  GmailReadResource,
  GmailTransport,
  GmailThread,
  GmailThreadOptions,
} from './contracts';
import { ProviderError } from './errors';

const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const cursor = (value: unknown): value is string =>
  typeof value === 'string' && /^[\x21-\x7e]{1,4096}$/.test(value);
const header = (value: unknown): value is string =>
  typeof value === 'string' && /^[!#$%&'*+.^_`|~\w-]{1,128}$/.test(value);
const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function reject(): never {
  throw new ProviderError('google', 'REQUEST_REJECTED');
}
function invalid(): never {
  throw new ProviderError('google', 'INVALID_RESPONSE');
}
function keys(value: unknown, allowed: readonly string[]) {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    reject();
}
function strings(
  value: unknown,
  valid: (item: unknown) => boolean,
  limit = 100,
): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(valid);
}

// Also constrain the generic transport so callers cannot bypass page limits.
export function normalizeGmailQuery(
  resource: GmailReadResource,
  query: GmailQuery = {},
): GmailQuery {
  if (
    typeof resource !== 'string' ||
    !/^(?:profile|messages|(?:messages|threads)\/[A-Za-z0-9_-]{1,512})$/.test(
      resource,
    )
  )
    reject();
  const listing = resource === 'messages';
  keys(
    query,
    listing
      ? ['q', 'pageToken', 'maxResults', 'labelIds', 'includeSpamTrash']
      : resource === 'profile'
        ? []
        : ['format', 'metadataHeaders'],
  );
  if (listing) {
    const maxResults = query.maxResults === undefined ? 25 : query.maxResults;
    if (!integer(maxResults) || maxResults < 1 || maxResults > 100) reject();
    if (
      (query.q !== undefined &&
        (typeof query.q !== 'string' ||
          query.q.length > 4096 ||
          /\p{Cc}/u.test(query.q))) ||
      (query.pageToken !== undefined && !cursor(query.pageToken)) ||
      (query.labelIds !== undefined && !strings(query.labelIds, safeId)) ||
      (query.includeSpamTrash !== undefined &&
        typeof query.includeSpamTrash !== 'boolean')
    )
      reject();
    return {
      ...query,
      maxResults,
      includeSpamTrash: query.includeSpamTrash ?? false,
    };
  }
  if (resource === 'profile') return {};
  const format = query.format === undefined ? 'metadata' : query.format;
  if (
    ![
      'minimal',
      'metadata',
      'full',
      ...(resource.startsWith('messages/') ? ['raw'] : []),
    ].includes(String(format)) ||
    typeof format !== 'string' ||
    (query.metadataHeaders !== undefined &&
      (format !== 'metadata' || !strings(query.metadataHeaders, header)))
  )
    reject();
  return { ...query, format };
}

function listQuery(options: GmailListOptions): GmailQuery {
  keys(options, [
    'mailbox',
    'labelIds',
    'after',
    'before',
    'from',
    'unread',
    'maxResults',
    'pageToken',
  ]);
  const mailbox = options.mailbox === undefined ? 'inbox' : options.mailbox;
  if (!['inbox', 'sent', 'all'].includes(mailbox)) reject();
  if (options.labelIds !== undefined && !strings(options.labelIds, safeId))
    reject();
  const labels = [
    ...new Set([
      ...(mailbox === 'inbox' ? ['INBOX'] : mailbox === 'sent' ? ['SENT'] : []),
      ...(options.labelIds ?? []),
    ]),
  ];
  const search: string[] = [];
  for (const name of ['after', 'before'] as const) {
    const date = options[name];
    if (date === undefined) continue;
    if (
      !(date instanceof Date) ||
      !Number.isFinite(date.getTime()) ||
      date.getTime() < 0
    )
      reject();
    search.push(`${name}:${Math.floor(date.getTime() / 1000)}`);
  }
  if (options.after && options.before && options.after >= options.before)
    reject();
  if (options.from !== undefined) {
    if (
      typeof options.from !== 'string' ||
      options.from.length > 254 ||
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`|~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(
        options.from,
      )
    )
      reject();
    search.push(`from:"${options.from}"`);
  }
  if (options.unread !== undefined) {
    if (typeof options.unread !== 'boolean') reject();
    search.push(options.unread ? 'is:unread' : 'is:read');
  }
  return normalizeGmailQuery('messages', {
    ...(labels.length ? { labelIds: labels } : {}),
    ...(search.length ? { q: search.join(' ') } : {}),
    ...(options.maxResults !== undefined
      ? { maxResults: options.maxResults }
      : {}),
    ...(options.pageToken !== undefined
      ? { pageToken: options.pageToken }
      : {}),
  });
}

function reference(value: unknown): GmailMessageReference {
  if (!record(value) || !safeId(value.id) || !safeId(value.threadId)) invalid();
  return { id: value.id, threadId: value.threadId };
}
function page(value: unknown, limit: number): GmailMessagePage {
  if (!record(value)) invalid();
  const messages = value.messages === undefined ? [] : value.messages;
  if (
    !Array.isArray(messages) ||
    messages.length > limit ||
    (value.nextPageToken !== undefined && !cursor(value.nextPageToken)) ||
    (value.resultSizeEstimate !== undefined &&
      !integer(value.resultSizeEstimate))
  )
    invalid();
  return {
    messages: messages.map(reference),
    ...(value.nextPageToken !== undefined
      ? { nextPageToken: value.nextPageToken as string }
      : {}),
    ...(value.resultSizeEstimate !== undefined
      ? { resultSizeEstimate: value.resultSizeEstimate as number }
      : {}),
  };
}

function message(value: unknown, id: string): GmailMessage {
  const ref = reference(value);
  if (!record(value) || ref.id !== id) invalid();
  const result: GmailMessage = { ...ref };
  for (const name of ['snippet', 'raw', 'historyId', 'internalDate'] as const) {
    if (value[name] === undefined) continue;
    if (
      typeof value[name] !== 'string' ||
      ((name === 'historyId' || name === 'internalDate') &&
        !/^\d+$/.test(value[name]))
    )
      invalid();
    Object.assign(result, { [name]: value[name] });
  }
  if (value.labelIds !== undefined) {
    if (!strings(value.labelIds, safeId, 1000)) invalid();
    Object.assign(result, { labelIds: [...value.labelIds] });
  }
  if (value.sizeEstimate !== undefined) {
    if (!integer(value.sizeEstimate)) invalid();
    Object.assign(result, { sizeEstimate: value.sizeEstimate });
  }
  let remainingParts = 10000;
  function part(input: unknown, depth = 0): GmailMessagePart {
    if (!record(input) || depth > 50 || --remainingParts < 0) invalid();
    const output: GmailMessagePart = {};
    for (const name of ['partId', 'mimeType', 'filename'] as const) {
      if (input[name] === undefined) continue;
      if (typeof input[name] !== 'string') invalid();
      Object.assign(output, { [name]: input[name] });
    }
    if (input.headers !== undefined) {
      if (!Array.isArray(input.headers)) invalid();
      const headers = input.headers.map((item) => {
        if (
          !record(item) ||
          typeof item.name !== 'string' ||
          typeof item.value !== 'string'
        )
          invalid();
        return { name: item.name, value: item.value };
      });
      Object.assign(output, { headers });
    }
    if (input.body !== undefined) {
      if (
        !record(input.body) ||
        (input.body.size !== undefined && !integer(input.body.size)) ||
        (input.body.data !== undefined &&
          typeof input.body.data !== 'string') ||
        (input.body.attachmentId !== undefined &&
          typeof input.body.attachmentId !== 'string')
      )
        invalid();
      const { size, data, attachmentId } = input.body;
      Object.assign(output, {
        body: {
          ...(size !== undefined ? { size } : {}),
          ...(data !== undefined ? { data } : {}),
          ...(attachmentId !== undefined ? { attachmentId } : {}),
        },
      });
    }
    if (input.parts !== undefined) {
      if (!Array.isArray(input.parts)) invalid();
      Object.assign(output, {
        parts: input.parts.map((item) => part(item, depth + 1)),
      });
    }
    return output;
  }
  if (value.payload !== undefined)
    Object.assign(result, { payload: part(value.payload) });
  return result;
}

function thread(value: unknown, id: string): GmailThread {
  if (
    !record(value) ||
    value.id !== id ||
    (value.historyId !== undefined &&
      (typeof value.historyId !== 'string' || !/^\d+$/.test(value.historyId)))
  )
    invalid();
  const messages = value.messages === undefined ? [] : value.messages;
  if (!Array.isArray(messages) || messages.length > 1000) invalid();
  const seen = new Set<string>();
  const parsed = messages.map((item) => {
    const ref = reference(item);
    if (ref.threadId !== id || seen.has(ref.id)) invalid();
    seen.add(ref.id);
    return message(item, ref.id);
  });
  return {
    id,
    messages: parsed,
    ...(value.historyId !== undefined
      ? { historyId: value.historyId as string }
      : {}),
  };
}

export function withMessageQueries<T extends GmailTransport>(
  transport: T,
): Readonly<T & GmailClient> {
  return Object.freeze({
    ...transport,
    async listMessages(options: GmailListOptions = {}) {
      const query = listQuery(options);
      return page(
        await transport.get('messages', query),
        Number(query.maxResults),
      );
    },
    async getMessage(id: string, options: GmailGetOptions = {}) {
      if (!safeId(id)) reject();
      keys(options, ['format', 'metadataHeaders']);
      const query = normalizeGmailQuery(`messages/${id}`, { ...options });
      return message(await transport.get(`messages/${id}`, query), id);
    },
    async getThread(id: string, options: GmailThreadOptions = {}) {
      if (!safeId(id)) reject();
      keys(options, ['format', 'metadataHeaders']);
      const query = normalizeGmailQuery(`threads/${id}`, { ...options });
      return thread(await transport.get(`threads/${id}`, query), id);
    },
  });
}
