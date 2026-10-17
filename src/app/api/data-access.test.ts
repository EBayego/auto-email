import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DataAccessError } from '@/db/errors';
import { openUserDataAccess } from '@/db/user-data';
import { GET as getAccount } from './gmail-account/route';
import { GET as listRuns } from './processing-runs/route';
import { GET as getRun } from './processing-runs/[runId]/route';

vi.mock('server-only', () => ({}));
vi.mock('@/app/_lib/auth', () => ({ createServerAuthClient: vi.fn() }));
vi.mock('@/db/user-data', () => ({ openUserDataAccess: vi.fn() }));

const data = {
  gmailAccounts: { get: vi.fn() },
  processingRuns: { list: vi.fn(), findById: vi.fn() },
};
const runId = '20000000-0000-4000-8000-000000000081';
const request = new NextRequest(
  'https://app.example.com/api/processing-runs?user_id=victim&limit=5',
);

describe('endpoints de datos privados', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(openUserDataAccess).mockResolvedValue(
      data as unknown as Awaited<ReturnType<typeof openUserDataAccess>>,
    );
  });

  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)(
    'rechaza %s antes de consultar recursos',
    async (code, status) => {
      vi.mocked(openUserDataAccess).mockRejectedValue(
        new DataAccessError(code),
      );
      for (const response of [
        await getAccount(),
        await listRuns(request),
        await getRun(request, { params: Promise.resolve({ runId }) }),
      ]) {
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: code });
        expect(response.headers.get('cache-control')).toContain('no-store');
      }
      expect(data.processingRuns.findById).not.toHaveBeenCalled();
    },
  );

  it('lista únicamente mediante el contexto verificado e ignora propietarios de la URL', async () => {
    data.processingRuns.list.mockResolvedValue([{ id: runId }]);
    const response = await listRuns(request);
    expect(await response.json()).toEqual([{ id: runId }]);
    expect(data.processingRuns.list).toHaveBeenCalledWith(5);
  });

  it('una ejecución ajena y una inexistente producen el mismo 404', async () => {
    data.processingRuns.findById.mockResolvedValue(null);
    const response = await getRun(request, {
      params: Promise.resolve({ runId }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'NOT_FOUND' });
    expect(data.processingRuns.findById).toHaveBeenCalledWith(runId);
  });

  it('devuelve la ejecución accesible y la cuenta proyectada por los repositorios', async () => {
    data.processingRuns.findById.mockResolvedValue({ id: runId });
    data.gmailAccounts.get.mockResolvedValue({ id: 'own-account' });
    expect(
      await (
        await getRun(request, { params: Promise.resolve({ runId }) })
      ).json(),
    ).toEqual({ id: runId });
    expect(await (await getAccount()).json()).toEqual({ id: 'own-account' });
  });

  it('no devuelve detalles del proveedor en los errores', async () => {
    data.gmailAccounts.get.mockRejectedValue(new Error('private credential'));
    const response = await getAccount();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'UNAVAILABLE' });
  });

  it('los identificadores o límites inválidos producen 400', async () => {
    data.processingRuns.list.mockRejectedValue(
      new DataAccessError('INVALID_INPUT'),
    );
    expect((await listRuns(request)).status).toBe(400);
  });
});
