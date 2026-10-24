import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getResponsePolicy } from '@/app/_lib/response-policy';
import { defaultResponsePolicySettings } from '@/modules/policy/settings';
import { DataAccessError } from '@/db/errors';
import { GET, PUT } from './route';

vi.mock('@/app/_lib/response-policy', () => ({ getResponsePolicy: vi.fn() }));
const repository = { get: vi.fn(), set: vi.fn() };
const origin = 'http://localhost:3000';
function request(
  body: unknown = defaultResponsePolicySettings(),
  headers = {},
) {
  return new NextRequest(`${origin}/api/response-policy`, {
    method: 'PUT',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
describe('MAIL-045 API privada de políticas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getResponsePolicy).mockResolvedValue(repository as never);
    repository.get.mockResolvedValue({
      revision: 'a'.repeat(32),
      settings: defaultResponsePolicySettings(),
    });
    repository.set.mockResolvedValue({
      revision: 'b'.repeat(32),
      settings: defaultResponsePolicySettings(),
    });
  });
  it('lee y guarda usando exclusivamente la sesión y sin caché', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await response.json()).engineVersion).toBe('mail045-v1');
    expect((await PUT(request())).status).toBe(200);
    expect(repository.set).toHaveBeenCalledWith(
      defaultResponsePolicySettings(),
    );
  });
  it('rechaza peticiones entre orígenes antes de abrir el acceso autorizado', async () => {
    expect(
      (await PUT(request({}, { origin: 'https://foreign.invalid' }))).status,
    ).toBe(400);
    expect(getResponsePolicy).not.toHaveBeenCalled();
  });
  it.each([
    { userId: 'foreign' },
    { allowPayments: true },
    { blockedCategories: ['SEND'] },
    { blockedSenders: ['invalid'] },
    { blockedTopics: ['\u0000'] },
  ])(
    'rechaza identidad, excepciones o valores inválidos: %j',
    async (extra) => {
      expect(
        (await PUT(request({ ...defaultResponsePolicySettings(), ...extra })))
          .status,
      ).toBe(400);
      expect(repository.set).not.toHaveBeenCalled();
    },
  );
  it('limita el cuerpo anunciado y el realmente recibido', async () => {
    expect(
      (await PUT(request(undefined, { 'content-length': '65537' }))).status,
    ).toBe(400);
    expect((await PUT(request('x'.repeat(65537)))).status).toBe(400);
    expect(repository.set).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('devuelve %s sin detalles internos', async (code, status) => {
    vi.mocked(getResponsePolicy).mockRejectedValue(new DataAccessError(code));
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });
});
