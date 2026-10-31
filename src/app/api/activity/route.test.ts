import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { GET as detailGET } from './[jobId]/route';
import { getActivity } from '@/app/_lib/activity';
import { DataAccessError } from '@/db/errors';
import {
  activityDetailFixture,
  activityFeedFixture,
} from '../../../../tests/fixtures/activity';
vi.mock('@/app/_lib/activity', () => ({ getActivity: vi.fn() }));
const feed = vi.fn(),
  detail = vi.fn();
const request = (query = '') =>
  new NextRequest(`http://localhost/api/activity${query}`);
describe('MAIL-054 API privada de actividad', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    feed.mockResolvedValue(activityFeedFixture());
    detail.mockResolvedValue(activityDetailFixture());
    vi.mocked(getActivity).mockResolvedValue({ feed, detail });
  });
  it('devuelve la actividad con cabeceras privadas y filtro predeterminado', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(feed).toHaveBeenCalledWith({ status: 'ALL' });
  });
  it('valida el cursor antes de acceder a datos', async () => {
    const beforeId = crypto.randomUUID();
    expect(
      (
        await GET(
          request(
            `?status=FAILED&before=2026-10-31T10:00:00.123456Z&beforeId=${beforeId}`,
          ),
        )
      ).status,
    ).toBe(200);
    expect(feed).toHaveBeenCalledWith({
      status: 'FAILED',
      before: '2026-10-31T10:00:00.123456Z',
      beforeId,
    });
  });
  it.each([
    '?status=ALL&status=FAILED',
    '?status=invalid',
    '?userId=another',
    '?before=2026-10-31T10:00:00Z',
  ])('rechaza consultas inválidas %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(getActivity).not.toHaveBeenCalled();
  });
  it('devuelve un detalle propio sin permisos de escritura', async () => {
    const jobId = crypto.randomUUID();
    expect(
      (await detailGET(request(), { params: Promise.resolve({ jobId }) }))
        .status,
    ).toBe(200);
    expect(detail).toHaveBeenCalledWith(jobId);
  });
  it('rechaza ids inválidos antes de abrir el acceso', async () => {
    expect(
      (
        await detailGET(request(), {
          params: Promise.resolve({ jobId: 'invalid' }),
        })
      ).status,
    ).toBe(400);
    expect(getActivity).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['UNAVAILABLE', 503],
  ] as const)('maneja %s sin revelar detalles', async (code, status) => {
    detail.mockRejectedValue(new DataAccessError(code));
    const response = await detailGET(request(), {
      params: Promise.resolve({ jobId: crypto.randomUUID() }),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });
  it('oculta errores inesperados', async () => {
    feed.mockRejectedValue(new Error('private token'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'UNAVAILABLE' });
  });
});
