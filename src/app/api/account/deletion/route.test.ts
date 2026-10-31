import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { readAccountDeletionReceipt } from '@/db/account-deletion-receipt';
import { DataAccessError } from '@/db/errors';
vi.mock('@/db/account-deletion-receipt', () => ({
  readAccountDeletionReceipt: vi.fn(),
}));
describe('MAIL-055 resguardo de borrado', () => {
  beforeEach(() => vi.resetAllMocks());
  it('no devuelve estados sin el resguardo secreto del navegador', async () => {
    expect(
      (
        await GET(
          new NextRequest(
            'http://app.invalid/api/account/deletion?requestId=other',
          ),
        )
      ).status,
    ).toBe(404);
    expect(readAccountDeletionReceipt).not.toHaveBeenCalled();
  });
  it('permite consultar el estado mínimo después de eliminar la sesión', async () => {
    const state = {
      id: crypto.randomUUID(),
      status: 'COMPLETED' as const,
      phase: 'COMPLETED' as const,
      revocation: 'CONFIRMED' as const,
      requestedAt: '2026-10-31T10:00:00Z',
      completedAt: '2026-10-31T10:00:10Z',
    };
    vi.mocked(readAccountDeletionReceipt).mockResolvedValue(state);
    const response = await GET(
      new NextRequest('http://app.invalid/api/account/deletion', {
        headers: { cookie: `account-deletion-receipt=${'a'.repeat(64)}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(state);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('no filtra errores internos', async () => {
    vi.mocked(readAccountDeletionReceipt).mockRejectedValue(
      new DataAccessError('NOT_FOUND'),
    );
    expect(
      (
        await GET(
          new NextRequest('http://app.invalid/api/account/deletion', {
            headers: { cookie: 'account-deletion-receipt=unknown' },
          }),
        )
      ).status,
    ).toBe(404);
  });
});
