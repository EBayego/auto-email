import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getKnowledgeDocuments } from '@/app/_lib/knowledge-documents';
import { DataAccessError } from '@/db/errors';
import { DocumentError } from '@/modules/knowledge/documents';
import { GET, POST } from './route';
import { DELETE, GET as download, PATCH } from './[documentId]/route';
import { PATCH as setAudience } from './[documentId]/audience/route';

vi.mock('@/app/_lib/knowledge-documents', () => ({
  getKnowledgeDocuments: vi.fn(),
}));
const service = {
  list: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  reindex: vi.fn(),
  chunks: vi.fn(),
  search: vi.fn(),
  setValidity: vi.fn(),
  setAudience: vi.fn(),
};
const origin = 'http://localhost:3000';
const context = {
  params: Promise.resolve({
    documentId: '00000000-0000-4000-8000-000000000036',
  }),
};
function uploadRequest(headers: Record<string, string> = {}, form?: FormData) {
  const body = form ?? new FormData();
  if (!form)
    body.set(
      'file',
      new File(['Tarifas'], 'tarifas.txt', { type: 'text/plain' }),
    );
  return new NextRequest(`${origin}/api/knowledge/documents`, {
    method: 'POST',
    headers: { origin, ...headers },
    body,
  });
}
describe('MAIL-036 HTTP privado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getKnowledgeDocuments).mockResolvedValue(service);
    service.list.mockResolvedValue([]);
    service.setValidity.mockResolvedValue(undefined);
    service.upload.mockResolvedValue({ id: 'document' });
  });
  it('lista y sube usando exclusivamente la sesión', async () => {
    expect((await GET()).status).toBe(200);
    const response = await POST(uploadRequest());
    expect(response.status).toBe(201);
    expect(service.upload).toHaveBeenCalledWith(expect.any(File));
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('MAIL-046 cambia el alcance mediante la sesión y comprueba el origen', async () => {
    const body = { kind: 'RECIPIENT', key: 'contact@example.invalid' };
    const request = (source = origin) =>
      new NextRequest(`${origin}/api/knowledge/documents/id/audience`, {
        method: 'PATCH',
        headers: { origin: source, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await setAudience(request(), context)).status).toBe(204);
    expect(service.setAudience).toHaveBeenCalledWith(
      (await context.params).documentId,
      body,
    );
    service.setAudience.mockClear();
    expect(
      (await setAudience(request('https://evil.invalid'), context)).status,
    ).toBe(400);
    expect(service.setAudience).not.toHaveBeenCalled();
  });
  it('rechaza orígenes ajenos antes de abrir la sesión', async () => {
    expect(
      (await POST(uploadRequest({ origin: 'https://evil.invalid' }))).status,
    ).toBe(400);
    expect(getKnowledgeDocuments).not.toHaveBeenCalled();
  });
  it('rechaza campos de identidad y múltiples archivos', async () => {
    const form = new FormData();
    form.set('file', new File(['hola'], 'a.txt', { type: 'text/plain' }));
    form.set('userId', 'other');
    expect((await POST(uploadRequest({}, form))).status).toBe(400);
    expect(service.upload).not.toHaveBeenCalled();
  });
  it('rechaza cuerpos grandes por cabecera y por tamaño recibido', async () => {
    expect(
      (
        await POST(
          uploadRequest({ 'content-length': String(11 * 1024 * 1024) }),
        )
      ).status,
    ).toBe(413);
    const request = new NextRequest(`${origin}/api/knowledge/documents`, {
      method: 'POST',
      headers: { origin, 'content-type': 'multipart/form-data; boundary=test' },
      body: new Uint8Array(11 * 1024 * 1024),
    });
    expect((await POST(request)).status).toBe(413);
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('falla cerrado con %s', async (code, status) => {
    vi.mocked(getKnowledgeDocuments).mockRejectedValue(
      new DataAccessError(code),
    );
    expect((await POST(uploadRequest())).status).toBe(status);
  });
  it('expone la cuota y errores categóricos sin detalles internos', async () => {
    service.upload.mockRejectedValue(new DocumentError('DOCUMENT_LIMIT'));
    expect((await POST(uploadRequest())).status).toBe(409);
    service.upload.mockRejectedValue(new Error('secreto privado'));
    expect(await (await POST(uploadRequest())).json()).toEqual({
      error: 'UNAVAILABLE',
    });
  });
  it('elimina con validación de origen', async () => {
    const request = new NextRequest(`${origin}/api/knowledge/documents/id`, {
      method: 'DELETE',
      headers: { origin },
    });
    expect((await DELETE(request, context)).status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(
      (await context.params).documentId,
    );
  });
  it('MAIL-040 guarda la vigencia usando la sesión y el identificador de la ruta', async () => {
    const period = { validFrom: '2026-01-01', validUntil: '2026-12-31' };
    const response = await PATCH(
      new NextRequest(`${origin}/api/knowledge/documents/id`, {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(period),
      }),
      context,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(service.setValidity).toHaveBeenCalledWith(
      (await context.params).documentId,
      period,
    );
  });
  it.each([
    { body: 'not-json', headers: {} },
    { body: '{}', headers: { origin: 'https://evil.invalid' } },
    { body: ' '.repeat(1025), headers: {} },
    { body: '{}', headers: { 'content-length': '1025' } },
    { body: '{}', headers: { 'content-type': 'text/plain' } },
  ])(
    'MAIL-040 rechaza origen, formato o tamaño inválidos antes de modificar vigencia',
    async ({ body, headers }) => {
      const response = await PATCH(
        new NextRequest(`${origin}/api/knowledge/documents/id`, {
          method: 'PATCH',
          headers: {
            origin,
            'content-type': 'application/json',
            ...(headers as Record<string, string>),
          },
          body,
        }),
        context,
      );
      expect(response.status).toBe(400);
      expect(service.setValidity).not.toHaveBeenCalled();
    },
  );
  it('descarga como adjunto privado sin ejecutar contenido', async () => {
    service.download.mockResolvedValue({
      document: { name: 'Tarifas.txt', mime_type: 'text/plain' },
      blob: new Blob(['hola']),
    });
    const response = await download(
      new NextRequest(`${origin}/api/knowledge/documents/id`),
      context,
    );
    expect(response.headers.get('content-disposition')).toContain(
      'attachment;',
    );
    expect(response.headers.get('content-security-policy')).toContain(
      'sandbox',
    );
    expect(await response.text()).toBe('hola');
  });
});
