import { describe, expect, it, vi } from 'vitest';
import type { DataClient } from './models';
import { createPrivacyRequestExecutor } from './privacy-provider';
import { createProviderRequestGate } from './provider-request-gate';
import { PrivacyError } from '@/modules/privacy/notice';
import { assertPrivacyAuthorized } from './privacy';

const userId = '00000000-0000-4000-8000-000000000061';
const accountId = '10000000-0000-4000-8000-000000000061';
describe('MAIL-061 permisos en el límite de proveedores', () => {
  it.each([false, null])(
    'no invoca el proveedor sin autorización, aunque haya tokens (%s)',
    async (data) => {
      const rpc = vi.fn(async () => ({ data, error: null }));
      const operation = vi.fn();
      const execute = createPrivacyRequestExecutor(
        { rpc } as unknown as DataClient,
        userId,
      );
      await expect(execute('google', true, operation)).rejects.toThrow(
        PrivacyError,
      );
      expect(operation).not.toHaveBeenCalled();
    },
  );
  it('revalida tras las comprobaciones previas y antes de comunicar contenido', async () => {
    let allowed = true;
    const rpc = vi.fn(async () => ({ data: allowed, error: null }));
    const operation = vi.fn();
    const execute = createPrivacyRequestExecutor(
      { rpc } as unknown as DataClient,
      userId,
    );
    await expect(
      execute('openai', true, operation, async () => {
        allowed = false;
      }),
    ).rejects.toThrow('PRIVACY_CONSENT_REQUIRED');
    expect(operation).not.toHaveBeenCalled();
  });
  it('un fallo de lectura cierra el acceso sin filtrar mensajes internos', async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'sensitive-database-message' },
      })),
    } as unknown as DataClient;
    await expect(assertPrivacyAuthorized(client, userId)).rejects.toMatchObject(
      { code: 'UNAVAILABLE', message: 'UNAVAILABLE' },
    );
  });
  it.each(['google', 'openai'] as const)(
    'retira el permiso de cuota si se revoca mientras espera (%s)',
    async (provider) => {
      let reads = 0;
      const leaseId = crypto.randomUUID();
      const rpc = vi.fn(async (name: string) => {
        if (name === 'privacy_authorization_valid')
          return { data: ++reads === 1, error: null };
        if (name === 'acquire_provider_request')
          return {
            data: [{ lease_id: leaseId, retry_after_ms: 0 }],
            error: null,
          };
        return { data: null, error: null };
      });
      const gate = createProviderRequestGate(
        { rpc } as unknown as DataClient,
        { userId, gmailAccountId: accountId },
        false,
      );
      await expect(
        gate.acquire(
          provider,
          {
            maxConcurrent: 2,
            accountMaxConcurrent: 1,
            requestsPerMinute: 100,
            accountRequestsPerMinute: 50,
          },
          60,
        ),
      ).rejects.toThrow('PRIVACY_CONSENT_REQUIRED');
      expect(rpc).toHaveBeenCalledWith(
        'release_provider_request',
        expect.objectContaining({ p_lease_id: leaseId }),
      );
    },
  );
});
