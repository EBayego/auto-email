import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnboardingWorkerStore, type AnalysisJob } from './onboarding';
import type { DataClient } from './models';

const job = {
  user_id: '00000000-0000-4000-8000-000000000001',
  lease_id: '00000000-0000-4000-8000-000000000002',
} as AnalysisJob;
const unavailable = {
  data: null,
  error: { code: 'PGRST003', message: 'private-database-details' },
  status: 504,
};

afterEach(() => vi.useRealTimers());

describe('checkpoint del análisis de enviados', () => {
  it.each([
    unavailable,
    { ...unavailable, status: 0, error: { ...unavailable.error, code: '' } },
    { ...unavailable, status: 429 },
    {
      ...unavailable,
      status: 400,
      error: { ...unavailable.error, code: '40P01' },
    },
  ])(
    'reintenta fallos temporales sin cambiar la autorización del checkpoint',
    async (failure) => {
      vi.useFakeTimers();
      const rpc = vi
        .fn()
        .mockResolvedValueOnce(failure)
        .mockResolvedValue({ data: true, error: null, status: 200 });
      const store = createOnboardingWorkerStore({
        rpc,
      } as unknown as DataClient);
      const result = store.advance(job, 'SAMPLING', 37, 0);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toBeUndefined();
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
      expect(rpc).toHaveBeenCalledWith('advance_onboarding_analysis', {
        p_user_id: job.user_id,
        p_lease_id: job.lease_id,
        p_phase: 'SAMPLING',
        p_scanned: 37,
        p_selected: 0,
      });
    },
  );

  it('se detiene tras tres intentos y no expone el error de la base', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn().mockResolvedValue(unavailable);
    const store = createOnboardingWorkerStore({ rpc } as unknown as DataClient);
    const result = expect(
      store.advance(job, 'SAMPLING', 37, 0),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
    await vi.runAllTimersAsync();
    await result;
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it.each([
    { data: false, error: null, status: 200 },
    { data: null, error: { code: '42501', message: 'FORBIDDEN' }, status: 403 },
    {
      data: null,
      error: { code: '23514', message: 'private-constraint' },
      status: 400,
    },
  ])(
    'no reintenta cancelaciones, permisos ni errores permanentes',
    async (failure) => {
      const rpc = vi.fn().mockResolvedValue(failure);
      const store = createOnboardingWorkerStore({
        rpc,
      } as unknown as DataClient);
      await expect(store.advance(job, 'SAMPLING', 37, 0)).rejects.toThrow();
      expect(rpc).toHaveBeenCalledOnce();
    },
  );

  it('respeta la pérdida de autorización después de un fallo temporal', async () => {
    vi.useFakeTimers();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValue({ data: false, error: null, status: 200 });
    const store = createOnboardingWorkerStore({ rpc } as unknown as DataClient);
    const result = expect(
      store.advance(job, 'ANALYZING', 100, 80),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.runAllTimersAsync();
    await result;
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
