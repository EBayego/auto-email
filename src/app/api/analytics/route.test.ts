import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { getAnalytics } from '@/app/_lib/analytics';
import { DataAccessError } from '@/db/errors';
import { analyticsFixture } from '../../../../tests/fixtures/analytics';
vi.mock('@/app/_lib/analytics', () => ({ getAnalytics: vi.fn() }));
const get = vi.fn();
const request = (query = '') =>
  new NextRequest(`https://app.invalid/api/analytics${query}`);
describe('MAIL-060 API privada de métricas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    get.mockResolvedValue(analyticsFixture());
    vi.mocked(getAnalytics).mockResolvedValue({ get });
  });
  it('devuelve la agregación del usuario validado sin caché', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(analyticsFixture());
    expect(get).toHaveBeenCalledWith({ days: '30' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([
    '?days=0',
    '?days=365',
    '?days=7&days=30',
    '?userId=otro',
    '?days=7&asOf=2026-01-01',
  ])('rechaza filtros no autorizados %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(getAnalytics).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('protege sesión %s', async (code, status) => {
    vi.mocked(getAnalytics).mockRejectedValue(new DataAccessError(code));
    expect((await GET(request())).status).toBe(status);
  });
  it('no expone detalles internos de fallos', async () => {
    get.mockRejectedValue(new Error('PRIVATE_DATA'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE_DATA');
  });
});
