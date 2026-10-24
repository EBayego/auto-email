import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getKnowledgeSources } from '@/app/_lib/knowledge-sources';
import { SourceConfigurationError } from '@/modules/source-router/sources';
import { DataAccessError } from '@/db/errors';
import { GET, POST } from './route';
vi.mock('@/app/_lib/knowledge-sources', () => ({
  getKnowledgeSources: vi.fn(),
}));
const sources = {
  list: vi.fn(),
  mutate: vi.fn(),
  plan: vi.fn(),
  search: vi.fn(),
  retrieve: vi.fn(),
};
const origin = 'http://localhost:3000';
const source = {
  action: 'save_source',
  title: 'Tarifas',
  priority: 10,
  enabled: true,
};
function request(body: unknown = source, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/knowledge/sources`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
describe('MAIL-038 gestión HTTP privada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getKnowledgeSources).mockResolvedValue(sources);
    sources.list.mockResolvedValue({ revision: 'r', sources: [], rules: [] });
    sources.mutate.mockResolvedValue({ id: 'source' });
  });
  it('consulta y guarda solo a través de la sesión validada', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await POST(request())).status).toBe(200);
    expect(sources.mutate).toHaveBeenCalledWith(source);
  });
  it('rechaza otro origen antes de abrir la sesión', async () => {
    expect(
      (await POST(request(source, { origin: 'https://evil.invalid' }))).status,
    ).toBe(400);
    expect(getKnowledgeSources).not.toHaveBeenCalled();
  });
  it.each([
    { ...source, userId: 'other' },
    { ...source, priority: 1001 },
    { ...source, enabled: 'true' },
    { action: 'send_email' },
  ])('rechaza identidades y operaciones no válidas', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(sources.mutate).not.toHaveBeenCalled();
  });
  it('rechaza contenido no JSON y cuerpos excesivos con y sin cabecera de longitud', async () => {
    expect((await POST(request('bad-json'))).status).toBe(400);
    expect(
      (await POST(request(source, { 'content-type': 'text/plain' }))).status,
    ).toBe(400);
    expect(
      (await POST(request(source, { 'content-length': '20000' }))).status,
    ).toBe(400);
    expect((await POST(request(' '.repeat(16385)))).status).toBe(400);
    expect(sources.mutate).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('falla cerrado con %s', async (code, status) => {
    vi.mocked(getKnowledgeSources).mockRejectedValue(new DataAccessError(code));
    expect((await POST(request())).status).toBe(status);
    expect(sources.mutate).not.toHaveBeenCalled();
  });
  it('expone conflictos categóricos sin revelar detalles internos', async () => {
    sources.mutate.mockRejectedValue(
      new SourceConfigurationError('SOURCE_IN_USE'),
    );
    expect((await POST(request())).status).toBe(409);
    sources.mutate.mockRejectedValue(new Error('detalles privados'));
    expect(await (await POST(request())).json()).toEqual({
      error: 'UNAVAILABLE',
    });
  });
});
