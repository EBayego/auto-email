import { createHash } from 'node:crypto';
import { DataAccessError, requireUuid } from './errors';
import type { DataClient } from './models';
import { getErasureLedger } from '@/modules/security/erasure-ledger';
import { SecretValue } from '@/config/env';
import {
  AccountDeletionError,
  deletionStatusSchema,
  type AccountDeletionStore,
  type DeletionTask,
} from '@/modules/account/lifecycle';
export const deletionReceiptHash = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');
export function createAccountLifecycleRepository(
  client: DataClient,
  userId: string,
) {
  requireUuid(userId);
  return Object.freeze({
    async get() {
      const [profile, events] = await Promise.all([
        client
          .from('style_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        client
          .from('account_data_events')
          .select('id,action,created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);
      if (profile.error || events.error)
        throw new DataAccessError('UNAVAILABLE');
      return { profileCount: profile.count ?? 0, events: events.data ?? [] };
    },
    async resetStyle() {
      const { data, error } = await client.rpc('delete_writing_identity', {
        p_user_id: userId,
      });
      if (error?.message === 'FORBIDDEN')
        throw new DataAccessError('FORBIDDEN');
      if (error || data !== true) throw new DataAccessError('UNAVAILABLE');
    },
    async requestDeletion(receipt: string) {
      const owner = await client
        .from('users')
        .select('status')
        .eq('id', userId)
        .maybeSingle();
      if (owner.error) throw new DataAccessError('UNAVAILABLE');
      if (
        !owner.data ||
        !['ACTIVE', 'DELETION_PENDING'].includes(owner.data.status)
      )
        throw new DataAccessError('FORBIDDEN');
      // Persist outside the database backup before acknowledging an erasure.
      await getErasureLedger()?.record(userId);
      const { data, error } = await client.rpc('request_account_deletion', {
        p_user_id: userId,
        p_receipt_hash: deletionReceiptHash(receipt),
      });
      if (error?.message === 'FORBIDDEN')
        throw new DataAccessError('FORBIDDEN');
      if (error || !data) throw new DataAccessError('UNAVAILABLE');
      return data;
    },
  });
}
export async function getDeletionReceipt(client: DataClient, receipt: string) {
  if (!/^[a-f0-9]{64}$/.test(receipt)) throw new DataAccessError('NOT_FOUND');
  const { data, error } = await client
    .from('account_deletion_requests')
    .select('id,status,phase,revocation,requested_at,completed_at')
    .eq('receipt_hash', deletionReceiptHash(receipt))
    .maybeSingle();
  if (error) throw new DataAccessError('UNAVAILABLE');
  if (!data) throw new DataAccessError('NOT_FOUND');
  const parsed = deletionStatusSchema.safeParse({
    id: data.id,
    status: data.status,
    phase: data.phase,
    revocation: data.revocation,
    requestedAt: data.requested_at,
    completedAt: data.completed_at,
  });
  if (!parsed.success) throw new DataAccessError('UNAVAILABLE');
  return parsed.data;
}
export function createAccountDeletionStore(
  client: DataClient,
  revoke: (credential: {
    userId: string;
    email: string;
    token: SecretValue;
  }) => Promise<void>,
): AccountDeletionStore {
  async function checkpoint(
    task: DeletionTask,
    error?: Parameters<AccountDeletionStore['checkpoint']>[1],
  ) {
    const result = await client.rpc('advance_account_deletion', {
      p_request_id: task.id,
      p_lease_id: task.leaseId,
      p_phase: task.phase,
      p_revocation: task.revocation,
      p_error: error,
    });
    if (result.error || result.data !== true)
      throw new AccountDeletionError('DATABASE_UNAVAILABLE');
  }
  return Object.freeze<AccountDeletionStore>({
    async claim(requestId) {
      if (requestId) requireUuid(requestId);
      const { data, error } = await client.rpc('claim_account_deletion', {
        p_request_id: requestId,
      });
      if (error) throw new AccountDeletionError('DATABASE_UNAVAILABLE');
      const row = data?.[0];
      if (!row) return null;
      if (!row.lease_id) throw new AccountDeletionError('DATABASE_UNAVAILABLE');
      return {
        id: row.id,
        userId: row.user_id,
        leaseId: row.lease_id,
        phase: row.phase as DeletionTask['phase'],
        revocation: row.revocation as DeletionTask['revocation'],
      };
    },
    checkpoint,
    async revoke(task) {
      const result = await client
        .from('gmail_accounts')
        .select('email,encrypted_refresh_token')
        .eq('user_id', task.userId!)
        .maybeSingle();
      if (result.error) throw new AccountDeletionError('DATABASE_UNAVAILABLE');
      if (!result.data?.encrypted_refresh_token) return 'NOT_CONNECTED';
      try {
        await revoke({
          userId: task.userId!,
          email: result.data.email,
          token: new SecretValue(result.data.encrypted_refresh_token),
        });
        return 'CONFIRMED';
      } catch {
        return 'UNCONFIRMED';
      }
    },
    async removeFiles(task) {
      const owner = task.userId!;
      requireUuid(owner);
      const storage = client.storage.from('knowledge-documents');
      for (let page = 0; page < 100; page++) {
        await checkpoint(task);
        const list = await storage.list(owner, { limit: 100 });
        if (list.error || !list.data)
          throw new AccountDeletionError('STORAGE_UNAVAILABLE');
        if (!list.data.length) return;
        const paths = list.data.map((file) => {
          if (
            !file.id ||
            !file.name ||
            file.name.includes('/') ||
            file.name.includes('\\') ||
            file.name === '..'
          )
            throw new AccountDeletionError('STORAGE_UNAVAILABLE');
          return `${owner}/${file.name}`;
        });
        const removed = await storage.remove(paths);
        if (removed.error)
          throw new AccountDeletionError('STORAGE_UNAVAILABLE');
      }
      throw new AccountDeletionError('STORAGE_UNAVAILABLE');
    },
    async purgeData(task) {
      const result = await client.rpc('purge_account_data', {
        p_request_id: task.id,
        p_lease_id: task.leaseId,
      });
      if (result.error || result.data !== true)
        throw new AccountDeletionError('DATABASE_UNAVAILABLE');
    },
    async deleteIdentity(task) {
      await checkpoint(task);
      await getErasureLedger()?.record(task.userId!);
      const result = await client.auth.admin.deleteUser(task.userId!);
      if (result.error) throw new AccountDeletionError('AUTH_UNAVAILABLE');
    },
    async purgeAudit() {
      const { error } = await client.rpc('purge_account_audit');
      if (error) throw new AccountDeletionError('DATABASE_UNAVAILABLE');
    },
  });
}
