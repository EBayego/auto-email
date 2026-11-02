import { NextRequest } from 'next/server';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { GET, POST } from './route';
import { getSharePointContext } from '@/app/_lib/sharepoint';
import { SharePointError } from '@/modules/sharepoint/contracts';
import { DataAccessError } from '@/db/errors';

vi.mock('@/app/_lib/sharepoint', () => ({ getSharePointContext: vi.fn() }));
const service = {
  snapshot: vi.fn(),
  browse: vi.fn(),
  operate: vi.fn(),
  items: vi.fn(),
};
function request(body: unknown, origin = 'http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/knowledge/connectors', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
describe('HTTP privado de conectores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSharePointContext).mockResolvedValue(
      service as unknown as Awaited<ReturnType<typeof getSharePointContext>>,
    );
    service.snapshot.mockResolvedValue({ connections: [], connectors: [] });
    service.operate.mockResolvedValue(true);
  });
  it('exige sesión, incluso cuando el conector no está activado', async () => {
    vi.mocked(getSharePointContext).mockRejectedValue(
      new DataAccessError('UNAUTHENTICATED'),
    );
    expect(
      (
        await GET(
          new NextRequest('http://localhost:3000/api/knowledge/connectors'),
        )
      ).status,
    ).toBe(401);
    vi.mocked(getSharePointContext).mockRejectedValue(
      new SharePointError('CONNECTOR_DISABLED'),
    );
    expect(
      await (
        await GET(
          new NextRequest('http://localhost:3000/api/knowledge/connectors'),
        )
      ).json(),
    ).toMatchObject({ enabled: false });
  });
  it('rechaza otro origen antes de acceder a la sesión', async () => {
    expect(
      (
        await POST(
          request({ action: 'sync', id: 'id' }, 'https://evil.invalid'),
        )
      ).status,
    ).toBe(400);
    expect(getSharePointContext).not.toHaveBeenCalled();
  });
  it('rechaza parámetros duplicados e identidades de navegación', async () => {
    expect(
      (
        await GET(
          new NextRequest(
            'http://localhost:3000/api/knowledge/connectors?id=a&id=b',
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            action: 'browse',
            connectionId: '00000000-0000-4000-8000-000000000401',
            userId: 'other',
          }),
        )
      ).status,
    ).toBe(400);
    expect(service.browse).not.toHaveBeenCalled();
  });
  it('desactiva caché en respuestas privadas y normaliza errores', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/knowledge/connectors'),
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    service.operate.mockRejectedValue(new Error('private provider response'));
    const failed = await POST(request({ action: 'sync', id: 'id' }));
    expect(await failed.json()).toEqual({ error: 'UNAVAILABLE' });
  });
});
