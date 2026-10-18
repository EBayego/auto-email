import { describe, expect, it, vi } from 'vitest';
import type { GmailThreadOptions } from './contracts';
import { createGmailClient } from './gmail';
import { createEmailFixtures } from '../../tests/fixtures/emails';

const synthetic = createEmailFixtures().answered;
function fixture(body: unknown = synthetic) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(body));
  const token = vi.fn(async () => 'synthetic-private-token');
  return { client: createGmailClient(token, 1000, fetcher), token, fetcher };
}
describe('users.threads.get', () => {
  it('consulta metadatos por defecto y normaliza un hilo completo solo si se pide full', async () => {
    const f = fixture({
      ...synthetic,
      historyId: '123',
      access_token: 'ignored',
      snippet: 'not-needed',
    });
    const thread = await f.client.getThread(synthetic.id);
    expect(thread).toEqual({ ...synthetic, historyId: '123' });
    expect(String(f.fetcher.mock.calls[0][0])).toBe(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${synthetic.id}?format=metadata`,
    );
    await f.client.getThread(synthetic.id, { format: 'full' });
    expect(String(f.fetcher.mock.calls[1][0])).toContain('format=full');
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
    });
  });
  it('permite cabeceras concretas y un hilo vacío, sin inventar mensajes', async () => {
    const f = fixture({ id: synthetic.id });
    expect(
      await f.client.getThread(synthetic.id, {
        metadataHeaders: ['From', 'To'],
      }),
    ).toEqual({ id: synthetic.id, messages: [] });
    expect(
      new URL(String(f.fetcher.mock.calls[0][0])).searchParams.getAll(
        'metadataHeaders',
      ),
    ).toEqual(['From', 'To']);
  });
  it.each([
    ['../profile', {}],
    ['', {}],
    [synthetic.id, { format: 'raw' }],
    [synthetic.id, { format: 'full', metadataHeaders: ['Subject'] }],
    [synthetic.id, { userId: 'other' }],
    [synthetic.id, { metadataHeaders: ['From\r\nOther'] }],
  ])(
    'rechaza rutas o parámetros inválidos (%s, %j) antes de pedir tokens',
    async (id, options) => {
      const f = fixture();
      await expect(
        f.client.getThread(id as string, options as GmailThreadOptions),
      ).rejects.toMatchObject({ code: 'REQUEST_REJECTED' });
      expect(f.token).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    [],
    {},
    { id: 'different', messages: [] },
    { id: synthetic.id, messages: null },
    { id: synthetic.id, historyId: 123 },
    { id: synthetic.id, historyId: 'NaN' },
    { id: synthetic.id, messages: [null] },
    {
      id: synthetic.id,
      messages: [{ ...synthetic.messages[0], threadId: 'different' }],
    },
    {
      id: synthetic.id,
      messages: [synthetic.messages[0], synthetic.messages[0]],
    },
    {
      id: synthetic.id,
      messages: [{ ...synthetic.messages[0], payload: { body: { data: 42 } } }],
    },
    { id: synthetic.id, messages: Array(1001).fill(synthetic.messages[0]) },
  ])('rechaza respuestas de hilo inválidas o cruzadas (%j)', async (body) => {
    await expect(
      fixture(body).client.getThread(synthetic.id),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([
    [401, 'ACCESS_TOKEN_REJECTED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'UNAVAILABLE'],
  ] as const)(
    'propaga HTTP %s sin divulgar contenido ni reintentar',
    async (status, code) => {
      const f = fixture();
      f.fetcher.mockResolvedValue(
        Response.json(
          { error: { message: 'synthetic-private-token private-email-body' } },
          { status },
        ),
      );
      const error = await f.client
        .getThread(synthetic.id)
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ code });
      expect(String(error) + JSON.stringify(error)).not.toMatch(
        /synthetic-private-token|private-email-body/,
      );
      expect(f.fetcher).toHaveBeenCalledOnce();
    },
  );
});
