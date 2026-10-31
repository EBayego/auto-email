import { z } from 'zod';
export const lifecycleOperationSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('reset_style'),
    confirmation: z.literal('BORRAR ESTILO'),
  }),
  z.strictObject({
    action: z.literal('delete_account'),
    confirmation: z.literal('ELIMINAR MI CUENTA'),
    email: z.email().max(254),
  }),
]);
export const deletionPhases = [
  'REVOKE',
  'FILES',
  'DATA',
  'AUTH',
  'COMPLETED',
] as const;
export const deletionRevocations = [
  'PENDING',
  'CONFIRMED',
  'UNCONFIRMED',
  'NOT_CONNECTED',
] as const;
export const deletionStatusSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['QUEUED', 'RUNNING', 'RETRY', 'COMPLETED']),
  phase: z.enum(deletionPhases),
  revocation: z.enum(deletionRevocations),
  requestedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type DeletionStatus = z.infer<typeof deletionStatusSchema>;
export type DeletionTask = {
  id: string;
  userId: string | null;
  leaseId: string;
  phase: (typeof deletionPhases)[number];
  revocation: (typeof deletionRevocations)[number];
};
export type DeletionError =
  | 'STORAGE_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'AUTH_UNAVAILABLE'
  | 'UNAVAILABLE';
export class AccountDeletionError extends Error {
  constructor(readonly code: DeletionError) {
    super(code);
    this.name = 'AccountDeletionError';
  }
}
export interface AccountDeletionStore {
  claim(requestId?: string): Promise<DeletionTask | null>;
  checkpoint(task: DeletionTask, error?: DeletionError): Promise<void>;
  revoke(task: DeletionTask): Promise<DeletionTask['revocation']>;
  removeFiles(task: DeletionTask): Promise<void>;
  purgeData(task: DeletionTask): Promise<void>;
  deleteIdentity(task: DeletionTask): Promise<void>;
  purgeAudit(): Promise<void>;
}
export async function runAccountDeletions(
  store: AccountDeletionStore,
  options: {
    requestId?: string;
    limit?: number;
    signal?: AbortSignal;
    report?: (event: {
      type: 'ACCOUNT_DELETION_COMPLETED' | 'ACCOUNT_DELETION_RETRY';
      requestId: string;
    }) => void;
  } = {},
) {
  let completed = 0,
    failed = 0;
  await store.purgeAudit();
  for (
    let index = 0;
    index < (options.limit ?? 5) && !options.signal?.aborted;
    index++
  ) {
    const task = await store.claim(options.requestId);
    if (!task) break;
    try {
      if (!task.userId) {
        task.phase = 'COMPLETED';
        await store.checkpoint(task);
        completed++;
        continue;
      }
      if (task.phase === 'REVOKE') {
        task.revocation = await store.revoke(task);
        task.phase = 'FILES';
        await store.checkpoint(task);
      }
      if (task.phase === 'FILES') {
        await store.removeFiles(task);
        task.phase = 'DATA';
        await store.checkpoint(task);
      }
      if (task.phase === 'DATA') {
        await store.purgeData(task);
        task.phase = 'AUTH';
        await store.checkpoint(task);
      }
      if (task.phase === 'AUTH') {
        await store.deleteIdentity(task);
        task.userId = null;
        task.phase = 'COMPLETED';
        await store.checkpoint(task);
      }
      completed++;
      options.report?.({
        type: 'ACCOUNT_DELETION_COMPLETED',
        requestId: task.id,
      });
    } catch (error) {
      failed++;
      await store
        .checkpoint(
          task,
          error instanceof AccountDeletionError ? error.code : 'UNAVAILABLE',
        )
        .catch(() => undefined);
      options.report?.({ type: 'ACCOUNT_DELETION_RETRY', requestId: task.id });
    }
    if (options.requestId) break;
  }
  return { completed, failed: failed > 0 };
}
