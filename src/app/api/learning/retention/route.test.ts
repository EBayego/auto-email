import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from './route';
import { getGenerationRetention } from '@/app/_lib/generation-retention';
import { DataAccessError } from '@/db/errors';
vi.mock('@/app/_lib/generation-retention', () => ({
  getGenerationRetention: vi.fn(),
}));
vi.mock('@/modules/auth/config', () => ({
  getAuthConfig: () => ({ appOrigin: 'https://app.invalid' }),
}));
const get = vi.fn(),
  set = vi.fn();
const accountId = '00000000-0000-4000-8000-000000000056';
function request(headers: Record<string, string> = {}) {
  return new NextRequest('https://app.invalid/api/learning/retention', {
    method: 'PUT',
    headers: {
      origin: 'https://app.invalid',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ accountId, enabled: false }),
  });
}
describe('MAIL-056 autorización temporal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getGenerationRetention).mockResolvedValue({ get, set });
    get.mockResolvedValue({ accountId, enabled: false });
  });
  it('consulta la cuenta propia sin caché', async () => {
    const response = await GET(
      new NextRequest(
        `https://app.invalid/api/learning/retention?accountId=${accountId}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(get).toHaveBeenCalledWith(accountId);
  });
  it('retira la autorización mediante una sesión autenticada', async () => {
    expect((await PUT(request())).status).toBe(204);
    expect(set).toHaveBeenCalledWith({ accountId, enabled: false });
  });
  it.each<Record<string, string>>([
    { origin: 'https://evil.invalid' },
    { 'content-type': 'text/plain' },
    { 'sec-fetch-site': 'cross-site' },
    { 'content-length': '1025' },
  ])('rechaza origen, formato o tamaño no permitido: %j', async (headers) => {
    expect((await PUT(request(headers))).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
  it('exige sesión y no expone detalles de errores', async () => {
    vi.mocked(getGenerationRetention).mockRejectedValue(
      new DataAccessError('UNAUTHENTICATED'),
    );
    expect((await PUT(request())).status).toBe(401);
    vi.mocked(getGenerationRetention).mockRejectedValue(
      new Error('SECRET_BODY'),
    );
    const response = await PUT(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('SECRET_BODY');
  });
});
