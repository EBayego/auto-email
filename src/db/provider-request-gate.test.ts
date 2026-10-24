import { describe, expect, it, vi } from 'vitest';
import type { DataClient } from './models';
import { createProviderRequestGate } from './provider-request-gate';

const work = {
  userId: '00000000-0000-4000-8000-000000000001',
  gmailAccountId: '00000000-0000-4000-8000-000000000002',
};
const lease = '00000000-0000-4000-8000-000000000003';
const limits = {
  maxConcurrent: 4,
  accountMaxConcurrent: 1,
  requestsPerMinute: 120,
  accountRequestsPerMinute: 60,
};
describe('EPIC-05 controles tras adquirir cuota', () => {
  it.each([false, null])(
    'no concede una petición si el control cambia mientras se adquiere cuota: %s',
    async (allowed) => {
      let permissionReads = 0;
      const rpc = vi.fn(async (name: string) => {
        if (name === 'gmail_execution_allowed')
          return {
            data: ++permissionReads === 1 ? true : allowed,
            error: null,
          };
        if (name === 'acquire_provider_request')
          return {
            data: [{ lease_id: lease, retry_after_ms: 0 }],
            error: null,
          };
        return { data: null, error: null };
      });
      const gate = createProviderRequestGate(
        { rpc } as unknown as DataClient,
        work,
        true,
      );
      await expect(gate.acquire('google', limits, 40)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(rpc).toHaveBeenCalledWith('release_provider_request', {
        p_user_id: work.userId,
        p_account_id: work.gmailAccountId,
        p_lease_id: lease,
      });
    },
  );
  it('no devuelve un permiso si no puede revalidar el control y mantiene el error de almacenamiento', async () => {
    let permissionReads = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'gmail_execution_allowed')
        return ++permissionReads === 1
          ? { data: true, error: null }
          : { data: null, error: { message: 'private-database-error' } };
      if (name === 'acquire_provider_request')
        return { data: [{ lease_id: lease, retry_after_ms: 0 }], error: null };
      throw new Error('release unavailable');
    });
    const gate = createProviderRequestGate(
      { rpc } as unknown as DataClient,
      work,
      true,
    );
    await expect(gate.acquire('openai', limits, 40)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'UNAVAILABLE',
    });
  });
});
