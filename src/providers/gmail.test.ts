import { describe, expect, it, vi } from 'vitest';
import { createEmailFixtures } from '../../tests/fixtures/emails';
import type {
  GmailGetOptions,
  GmailListOptions,
  GmailReadResource,
} from './contracts';
import { createGmailClient } from './gmail';

const id = 'b100000000000001';
const ref = { id, threadId: 'a100000000000001' };
function fixture(body: unknown = {}) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(body));
  const token = vi.fn(async () => 'synthetic-private-token');
  const client = createGmailClient(token, 1000, fetcher);
  const url = (index = 0) => new URL(String(fetcher.mock.calls[index][0]));
  return { client, fetcher, token, url };
}

describe('consultas de mensajes Gmail (MAIL-014)', () => {
  it('limita el listado predeterminado a 25 referencias de recibidos, sin obtener cuerpos ni recorrer páginas', async () => {
    const f = fixture({
      messages: [{ ...ref, payload: 'ignored' }],
      nextPageToken: 'next',
      resultSizeEstimate: 200,
    });
    expect(await f.client.listMessages()).toEqual({
      messages: [ref],
      nextPageToken: 'next',
      resultSizeEstimate: 200,
    });
    expect(f.url().pathname).toBe('/gmail/v1/users/me/messages');
    expect(Object.fromEntries(f.url().searchParams)).toEqual({
      labelIds: 'INBOX',
      maxResults: '25',
      includeSpamTrash: 'false',
    });
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it('combina enviados, etiquetas, fechas con zona horaria, remitente y estado de lectura', async () => {
    const f = fixture();
    const after = new Date('2026-10-01T00:00:00+02:00');
    const before = new Date('2026-10-17T12:00:00+02:00');
    await f.client.listMessages({
      mailbox: 'sent',
      labelIds: ['Label_42', 'SENT', 'STARRED'],
      after,
      before,
      from: 'contact+team@example.invalid',
      unread: false,
      maxResults: 10,
    });
    expect(f.url().searchParams.getAll('labelIds')).toEqual([
      'SENT',
      'Label_42',
      'STARRED',
    ]);
    expect(f.url().searchParams.get('q')).toBe(
      `after:${after.getTime() / 1000} before:${before.getTime() / 1000} from:"contact+team@example.invalid" is:read`,
    );
    expect(f.url().searchParams.get('maxResults')).toBe('10');
    expect(f.fetcher).toHaveBeenCalledOnce();
  });

  it('permite otras etiquetas y paginación explícita conservando filtros y el cursor opaco', async () => {
    const f = fixture();
    const next = 'cursor+/=&pageToken=other';
    f.fetcher
      .mockResolvedValueOnce(
        Response.json({ messages: [ref], nextPageToken: next }),
      )
      .mockResolvedValueOnce(Response.json({}));
    const options = {
      mailbox: 'all' as const,
      labelIds: ['UNREAD'],
      unread: true,
      maxResults: 1,
    };
    const first = await f.client.listMessages(options);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(
      await f.client.listMessages({
        ...options,
        pageToken: first.nextPageToken,
      }),
    ).toEqual({ messages: [] });
    expect(f.url(1).searchParams.get('pageToken')).toBe(next);
    expect(f.url(1).searchParams.getAll('labelIds')).toEqual(['UNREAD']);
    expect(f.url(1).searchParams.get('q')).toBe('is:unread');
    expect(f.url(1).searchParams.getAll('pageToken')).toHaveLength(1);
  });

  it('busca enviados por destinatario y términos literales sin permitir operadores desde texto externo', async () => {
    const f = fixture();
    await f.client.listMessages({
      mailbox: 'sent',
      to: 'client+team@example.invalid',
      textTerms: ['auditoría', 'energética'],
    });
    expect(f.url().searchParams.get('q')).toBe(
      'to:"client+team@example.invalid" {"auditoría" "energética"}',
    );
    expect(f.url().searchParams.getAll('labelIds')).toEqual(['SENT']);
  });

  it.each([{}, { messages: [] }, { resultSizeEstimate: 0 }])(
    'normaliza páginas vacías sin fabricar un total (%j)',
    async (response) => {
      const { client } = fixture(response);
      expect(await client.listMessages()).toEqual({
        messages: [],
        ...response,
      });
    },
  );

  it.each([
    { maxResults: 0 },
    { maxResults: 101 },
    { maxResults: 1.5 },
    { maxResults: '5' },
    { maxResults: null },
    { mailbox: 'draft' },
    { mailbox: null },
    { userId: 'other' },
    { q: 'anywhere' },
    { labelIds: 'INBOX' },
    { labelIds: ['bad label'] },
    { labelIds: Array(101).fill('INBOX') },
    { after: '2026-10-01' },
    { after: new Date(NaN) },
    { after: new Date('2026-10-17'), before: new Date('2026-10-16') },
    { from: 'contact@example.invalid OR in:anywhere' },
    { from: 'a@b\n' },
    { from: 'a@b"} OR in:sent' },
    { from: 'a@b@c' },
    { to: 'a@b OR in:anywhere' },
    { to: 'a@b"}' },
    { textTerms: [] },
    { textTerms: ['in:anywhere'] },
    { textTerms: ['foo"}'] },
    { textTerms: ['foo\nbar'] },
    { textTerms: ['x'.repeat(33)] },
    { textTerms: Array(6).fill('valid') },
    { textTerms: 'query' },
    { unread: 'true' },
    { pageToken: '' },
    { pageToken: 'line\nbreak' },
    { pageToken: 'a'.repeat(4097) },
  ])(
    'rechaza filtros inválidos antes de pedir credenciales o red: %j',
    async (options) => {
      const f = fixture();
      await expect(
        f.client.listMessages(options as unknown as GmailListOptions),
      ).rejects.toMatchObject({ code: 'REQUEST_REJECTED', retryable: false });
      expect(f.token).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it('obtiene metadatos por defecto y restringe cabeceras cuando se solicitan explícitamente', async () => {
    const f = fixture({
      ...ref,
      payload: { headers: [{ name: 'Subject', value: 'Synthetic' }] },
    });
    expect((await f.client.getMessage(id)).payload?.headers).toEqual([
      { name: 'Subject', value: 'Synthetic' },
    ]);
    expect(f.url().searchParams.get('format')).toBe('metadata');
    await f.client.getMessage(id, {
      metadataHeaders: ['From', 'Subject', 'Message-ID'],
    });
    expect(f.url(1).searchParams.getAll('metadataHeaders')).toEqual([
      'From',
      'Subject',
      'Message-ID',
    ]);
    expect(f.url(1).pathname).toBe(`/gmail/v1/users/me/messages/${id}`);
  });

  it.each(['minimal', 'full', 'raw'] as const)(
    'obtiene el formato %s solo al pedirlo y conserva los datos originales',
    async (format) => {
      const synthetic = createEmailFixtures().pending.messages[0];
      const data =
        format === 'full'
          ? synthetic
          : format === 'raw'
            ? { ...ref, raw: 'RnJvbTogc3ludGhldGlj' }
            : ref;
      const f = fixture({ ...data, access_token: 'untrusted-extra-field' });
      expect(await f.client.getMessage(id, { format })).toEqual(data);
      expect(f.url().searchParams.get('format')).toBe(format);
      expect(f.fetcher).toHaveBeenCalledOnce();
    },
  );

  it('conserva multipart y referencias de adjuntos sin descargarlos ni decodificar MIME', async () => {
    const data = createEmailFixtures().attachment.messages[0];
    const f = fixture(data);
    expect(await f.client.getMessage(data.id, { format: 'full' })).toEqual(
      data,
    );
    expect(f.fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['../profile', {}],
    ['', {}],
    ['abc?alt=media', {}],
    [id, { format: 'anything' }],
    [id, { format: null }],
    [id, { format: 'full', metadataHeaders: ['Subject'] }],
    [id, { metadataHeaders: ['Subject\r\nAuthorization'] }],
    [id, { metadataHeaders: 'Subject' }],
    [id, { userId: 'other' }],
  ])(
    'rechaza identificadores u opciones de detalle inválidos (%s, %j)',
    async (messageId, options) => {
      const f = fixture();
      await expect(
        f.client.getMessage(messageId as string, options as GmailGetOptions),
      ).rejects.toMatchObject({ code: 'REQUEST_REJECTED' });
      expect(f.token).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    { messages: null },
    { messages: {} },
    { messages: [null] },
    { messages: [{ id }] },
    { messages: [{ ...ref, id: '../profile' }] },
    { messages: [ref, ref] },
    { nextPageToken: 123 },
    { resultSizeEstimate: -1 },
  ])(
    'rechaza páginas malformadas y respuestas mayores al límite solicitado (%j)',
    async (response) => {
      const { client } = fixture(response);
      await expect(
        client.listMessages({ maxResults: 1 }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
    },
  );

  it.each([
    null,
    {},
    { ...ref, id: 'different' },
    { ...ref, threadId: '' },
    { ...ref, labelIds: [42] },
    { ...ref, internalDate: 123 },
    { ...ref, historyId: 'NaN' },
    { ...ref, sizeEstimate: -1 },
    { ...ref, raw: {} },
    { ...ref, payload: { headers: [{ name: 'From', value: null }] } },
    { ...ref, payload: { body: { size: -1 } } },
    { ...ref, payload: { parts: [null] } },
  ])(
    'rechaza mensajes malformados sin exponer sus datos (%j)',
    async (response) => {
      const { client } = fixture(response);
      await expect(client.getMessage(id)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );

  it('también limita y valida las consultas del transporte genérico', async () => {
    const f = fixture();
    await f.client.get('messages');
    expect(f.url().searchParams.get('maxResults')).toBe('25');
    for (const [resource, query] of [
      ['profile', { q: 'anything' }],
      ['messages', { format: 'full' }],
      ['messages', { includeSpamTrash: 'true' }],
      ['messages', { maxResults: 500 }],
      [`messages/${id}`, { maxResults: 25 }],
      ['threads/abc', { format: 'raw' }],
      ['messages/1/send', {}],
      ['https://attacker.invalid', {}],
    ] as const) {
      await expect(
        f.client.get(resource as GmailReadResource, query),
      ).rejects.toMatchObject({ code: 'REQUEST_REJECTED' });
    }
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.token).toHaveBeenCalledOnce();
  });
});

describe('errores de consulta Gmail', () => {
  it.each([
    [401, undefined, 'ACCESS_TOKEN_REJECTED', false],
    [403, 'insufficientPermissions', 'PERMISSION_DENIED', false],
    [403, 'domainPolicy', 'PERMISSION_DENIED', false],
    [403, 'rateLimitExceeded', 'RATE_LIMITED', true],
    [403, 'userRateLimitExceeded', 'RATE_LIMITED', true],
    [403, 'dailyLimitExceeded', 'RATE_LIMITED', true],
    [403, 'quotaExceeded', 'RATE_LIMITED', true],
    [404, undefined, 'NOT_FOUND', false],
    [429, undefined, 'RATE_LIMITED', true],
    [400, undefined, 'REQUEST_REJECTED', false],
    [408, undefined, 'UNAVAILABLE', true],
    [503, undefined, 'UNAVAILABLE', true],
  ] as const)(
    'clasifica HTTP %s (%s), sin reintentar ni divulgar detalles',
    async (status, reason, code, retryable) => {
      const f = fixture();
      f.fetcher.mockResolvedValue(
        Response.json(
          {
            error: {
              message: 'synthetic-private-token private-email-content',
              errors: [{ reason }],
            },
          },
          { status, headers: { 'retry-after': '60' } },
        ),
      );
      const error = await f.client
        .listMessages()
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ code, retryable, httpStatus: status });
      expect(String(error) + JSON.stringify(error)).not.toMatch(
        /synthetic-private-token|private-email-content/,
      );
      expect(error).toHaveProperty(
        'retryAfterMs',
        retryable ? 60000 : undefined,
      );
      expect(f.fetcher).toHaveBeenCalledOnce();
    },
  );

  it('maneja errores sin JSON y Retry-After expresado como fecha', async () => {
    const f = fixture();
    const now = new Date('2026-10-17T10:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    f.fetcher.mockResolvedValue(
      new Response('private upstream page', {
        status: 503,
        headers: { 'retry-after': 'Sat, 17 Oct 2026 10:02:00 GMT' },
      }),
    );
    await expect(f.client.getMessage(id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      retryAfterMs: 120000,
    });
    f.fetcher.mockResolvedValue(
      new Response('private upstream page', { status: 403 }),
    );
    await expect(f.client.listMessages()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    f.fetcher.mockResolvedValue(
      new Response('private upstream page', { status: 200 }),
    );
    await expect(f.client.listMessages()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('sanitiza fallos de red pero conserva los errores del proveedor de credenciales', async () => {
    const f = fixture();
    f.fetcher.mockRejectedValue(
      new Error('synthetic-private-token url-with-private-query'),
    );
    await expect(f.client.listMessages()).rejects.toMatchObject({
      message: 'google: UNAVAILABLE',
      code: 'UNAVAILABLE',
    });
    const credentialError = new Error('REAUTH_REQUIRED');
    f.token.mockRejectedValue(credentialError);
    await expect(f.client.listMessages()).rejects.toBe(credentialError);
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
});
