import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  query: vi.fn(),
  config: vi.fn(),
}));
vi.mock('@/modules/security/erasure-ledger', () => ({
  getErasureLedger: () => ({ verify: mocks.verify }),
}));
vi.mock('@/config/env', () => ({ getDataServiceConfig: mocks.config }));
vi.mock('@/db/service-client', () => ({
  createServiceDataClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ limit: mocks.query }) }) }),
  }),
}));
import { GET as ready } from './ready/route';
import { GET as live } from './live/route';
beforeEach(() => {
  mocks.config.mockReturnValue({ timeoutMs: 1000 });
  mocks.query.mockResolvedValue({ data: [{ singleton: true }], error: null });
  mocks.verify.mockResolvedValue(undefined);
});
describe('MAIL-067 salud pública sin datos sensibles', () => {
  it('la comprobación de vida no consulta usuarios ni proveedores', async () => {
    expect(await live().json()).toEqual({ status: 'ok' });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('solo declara readiness si el registro y la base están disponibles', async () => {
    const response = await ready();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
  it.each(['ledger', 'database', 'maintenance', 'schema'])(
    'falla sin filtrar detalles ante %s',
    async (failure) => {
      if (failure === 'ledger')
        mocks.verify.mockRejectedValue(new Error('private-key'));
      if (failure === 'database')
        mocks.query.mockResolvedValue({
          error: { message: 'private-password' },
          data: null,
        });
      if (failure === 'schema')
        mocks.query.mockResolvedValue({ error: null, data: [] });
      if (failure === 'maintenance')
        vi.stubEnv('SECURITY_MAINTENANCE_MODE', 'true');
      const response = await ready();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ status: 'unavailable' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );
});
