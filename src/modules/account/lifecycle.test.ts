import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  AccountDeletionError,
  lifecycleOperationSchema,
  runAccountDeletions,
  type AccountDeletionStore,
  type DeletionTask,
} from './lifecycle';
const task = (): DeletionTask => ({
  id: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  leaseId: crypto.randomUUID(),
  phase: 'REVOKE',
  revocation: 'PENDING',
});
describe('MAIL-055 eliminación reintentable de cuenta', () => {
  let store: AccountDeletionStore, job: DeletionTask;
  let order: string[];
  beforeEach(() => {
    job = task();
    order = [];
    store = {
      claim: vi
        .fn()
        .mockImplementationOnce(async () => job)
        .mockResolvedValue(null),
      checkpoint: vi.fn(async (value, error) => {
        order.push(error ? 'RETRY' : value.phase);
      }),
      revoke: vi.fn(async () => {
        order.push('REVOKE');
        return 'CONFIRMED' as const;
      }),
      removeFiles: vi.fn(async () => {
        order.push('REMOVE_FILES');
      }),
      purgeData: vi.fn(async () => {
        order.push('PURGE_DATA');
      }),
      deleteIdentity: vi.fn(async () => {
        order.push('DELETE_AUTH');
      }),
      purgeAudit: vi.fn(async () => {}),
    };
  });
  it('retira credenciales y elimina archivos antes de datos y Auth', async () => {
    expect(await runAccountDeletions(store)).toEqual({
      completed: 1,
      failed: false,
    });
    expect(order).toEqual([
      'REVOKE',
      'FILES',
      'REMOVE_FILES',
      'DATA',
      'PURGE_DATA',
      'AUTH',
      'DELETE_AUTH',
      'COMPLETED',
    ]);
    expect(job.userId).toBeNull();
  });
  it('un fallo de Storage conserva la tarea para reintento sin borrar datos ni identidad', async () => {
    vi.mocked(store.removeFiles).mockRejectedValue(
      new AccountDeletionError('STORAGE_UNAVAILABLE'),
    );
    expect(await runAccountDeletions(store)).toEqual({
      completed: 0,
      failed: true,
    });
    expect(store.checkpoint).toHaveBeenLastCalledWith(
      job,
      'STORAGE_UNAVAILABLE',
    );
    expect(job.phase).toBe('FILES');
    expect(store.purgeData).not.toHaveBeenCalled();
    expect(store.deleteIdentity).not.toHaveBeenCalled();
  });
  it('reanuda desde Auth sin volver a consultar Google ni borrar archivos otra vez', async () => {
    job.phase = 'AUTH';
    expect(await runAccountDeletions(store)).toEqual({
      completed: 1,
      failed: false,
    });
    expect(store.revoke).not.toHaveBeenCalled();
    expect(store.removeFiles).not.toHaveBeenCalled();
    expect(store.deleteIdentity).toHaveBeenCalledOnce();
  });
  it('completa un resultado perdido tras eliminar Auth sin repetir su eliminación', async () => {
    job.userId = null;
    await runAccountDeletions(store);
    expect(store.deleteIdentity).not.toHaveBeenCalled();
    expect(job.phase).toBe('COMPLETED');
  });
  it('no da por completada una eliminación cuando Auth falla', async () => {
    vi.mocked(store.deleteIdentity).mockRejectedValue(
      new AccountDeletionError('AUTH_UNAVAILABLE'),
    );
    expect((await runAccountDeletions(store)).failed).toBe(true);
    expect(job.phase).toBe('AUTH');
    expect(job.userId).not.toBeNull();
  });
  it('borra igualmente los datos si la revocación no se puede confirmar', async () => {
    vi.mocked(store.revoke).mockResolvedValue('UNCONFIRMED');
    expect((await runAccountDeletions(store)).completed).toBe(1);
    expect(job.revocation).toBe('UNCONFIRMED');
  });
  it('no inicia trabajos después de cancelar el ciclo', async () => {
    await runAccountDeletions(store, { signal: AbortSignal.abort() });
    expect(store.claim).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'reset_style' },
    { action: 'reset_style', confirmation: 'yes' },
    {
      action: 'delete_account',
      confirmation: 'ELIMINAR MI CUENTA',
      email: 'bad',
    },
    {
      action: 'delete_account',
      confirmation: 'ELIMINAR MI CUENTA',
      email: 'owner@example.invalid',
      userId: crypto.randomUUID(),
    },
  ])('exige confirmación explícita y no admite otro propietario: %j', (input) =>
    expect(lifecycleOperationSchema.safeParse(input).success).toBe(false),
  );
});
