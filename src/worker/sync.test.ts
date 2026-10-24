import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataAccessError } from '@/db/errors';
import { ProviderError } from '@/providers/errors';
import type { GmailClient } from '@/providers/contracts';
import { GmailCredentialError } from '@/modules/gmail/credentials';
import { readSyncConfig } from './sync-config';
import {
  runSyncCycle,
  runSyncWorker,
  syncErrorCode,
  type GmailSyncStore,
  type SyncClaim,
} from './sync';

const claim: SyncClaim = {
  userId: '00000000-0000-4000-8000-000000000001',
  gmailAccountId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000003',
  windowStartAt: '2026-10-19T10:00:00.000Z',
  windowEndAt: '2026-10-20T10:00:00.000Z',
};
const config = readSyncConfig({});
const ref = { id: 'message_1', threadId: 'thread_1' };
function fixture() {
  const store = {
    claim: vi
      .fn<GmailSyncStore['claim']>()
      .mockResolvedValueOnce(claim)
      .mockResolvedValue(null),
    renew: vi.fn<GmailSyncStore['renew']>().mockResolvedValue(true),
    recordPage: vi.fn<GmailSyncStore['recordPage']>().mockResolvedValue(1),
    finish: vi.fn<GmailSyncStore['finish']>().mockResolvedValue(true),
  };
  const listMessages = vi
    .fn<GmailClient['listMessages']>()
    .mockResolvedValue({ messages: [ref] });
  const deps = {
    store,
    gmailFor: vi.fn(async () => ({ listMessages })),
    report: vi.fn(),
  };
  return { deps, store, listMessages };
}

afterEach(() => vi.useRealTimers());

describe('MAIL-029 sincronización periódica', () => {
  it('mantiene el lease durante lecturas largas, incluidas esperas de cuota y credenciales', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finishRead!: () => void;
    f.listMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ messages: [ref] });
        }),
    );
    const running = runSyncCycle(f.deps, { ...config, leaseSeconds: 30 });
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.store.renew.mock.calls.length).toBeGreaterThanOrEqual(5);
    finishRead();
    expect(await running).toEqual({ completed: 1, failed: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('no persiste una lectura si el heartbeat detectó pérdida del lease', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.store.renew.mockResolvedValueOnce(true).mockResolvedValue(false);
    let finishRead!: () => void;
    f.listMessages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ messages: [ref] });
        }),
    );
    const running = runSyncCycle(f.deps, { ...config, leaseSeconds: 30 });
    await vi.advanceTimersByTimeAsync(10000);
    finishRead();
    expect(await running).toEqual({ completed: 0, failed: 1 });
    expect(f.store.recordPage).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledWith(claim, 'SYNC_LEASE_LOST');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('recorre todas las páginas con una ventana fija y confirma solo después de persistirlas', async () => {
    const f = fixture();
    f.listMessages.mockResolvedValueOnce({
      messages: [ref],
      nextPageToken: 'next',
    });
    f.store.recordPage.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await runSyncCycle(f.deps, config)).toEqual({
      completed: 1,
      failed: 0,
    });
    expect(f.listMessages.mock.calls).toEqual([
      [
        {
          mailbox: 'incoming',
          after: new Date(claim.windowStartAt),
          before: new Date(claim.windowEndAt),
          maxResults: 100,
        },
      ],
      [
        {
          mailbox: 'incoming',
          after: new Date(claim.windowStartAt),
          before: new Date(claim.windowEndAt),
          maxResults: 100,
          pageToken: 'next',
        },
      ],
    ]);
    expect(f.store.renew).toHaveBeenCalledTimes(2);
    expect(f.store.recordPage).toHaveBeenCalledTimes(2);
    expect(f.store.finish).toHaveBeenCalledExactlyOnceWith(claim);
    expect(f.store.finish.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.store.recordPage.mock.invocationCallOrder[1],
    );
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SYNC_COMPLETED', messagesDetected: 1 }),
    );
  });

  it('no marca éxito cuando una página intermedia falla y continúa con otra cuenta', async () => {
    const f = fixture();
    const other = {
      ...claim,
      gmailAccountId: '00000000-0000-4000-8000-000000000004',
    };
    f.store.claim
      .mockReset()
      .mockResolvedValueOnce(claim)
      .mockResolvedValueOnce(other)
      .mockResolvedValue(null);
    f.listMessages
      .mockResolvedValueOnce({ messages: [ref], nextPageToken: 'next' })
      .mockRejectedValueOnce(new ProviderError('google', 'UNAVAILABLE'));
    expect(await runSyncCycle(f.deps, config)).toEqual({
      completed: 1,
      failed: 1,
    });
    expect(f.store.finish.mock.calls).toEqual([
      [claim, 'SYNC_UNAVAILABLE'],
      [other],
    ]);
  });

  it('trata el fallo de persistencia como fallo de sincronización', async () => {
    const f = fixture();
    f.store.recordPage.mockRejectedValueOnce(new Error('private-body'));
    await runSyncCycle(f.deps, config);
    expect(f.store.finish).toHaveBeenCalledExactlyOnceWith(
      claim,
      'SYNC_UNAVAILABLE',
    );
    expect(JSON.stringify(f.deps.report.mock.calls)).not.toContain(
      'private-body',
    );
  });

  it('no consulta Gmail si perdió el lease', async () => {
    const f = fixture();
    f.store.renew.mockResolvedValue(false);
    expect(await runSyncCycle(f.deps, config)).toEqual({
      completed: 0,
      failed: 1,
    });
    expect(f.listMessages).not.toHaveBeenCalled();
    expect(f.store.recordPage).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledWith(claim, 'SYNC_LEASE_LOST');
  });

  it('no publica éxito si la confirmación fue rechazada por un lease obsoleto', async () => {
    const f = fixture();
    f.store.finish.mockResolvedValue(false);
    expect(await runSyncCycle(f.deps, config)).toEqual({
      completed: 0,
      failed: 1,
    });
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'SYNC_LEASE_LOST' }),
    );
  });

  it('deja reconciliación recuperable cuando tampoco puede guardar el fallo', async () => {
    const f = fixture();
    f.listMessages.mockRejectedValue(new Error('private-token'));
    f.store.finish.mockRejectedValue(new DataAccessError('UNAVAILABLE'));
    expect(await runSyncCycle(f.deps, config)).toEqual({
      completed: 0,
      failed: 1,
    });
    expect(f.deps.report).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'SYNC_FAILED',
        errorCode: 'SYNC_UNAVAILABLE',
      }),
    );
  });

  it('detiene la paginación repetida sin confirmar la ventana', async () => {
    const f = fixture();
    f.listMessages.mockResolvedValue({
      messages: [ref],
      nextPageToken: 'loop',
    });
    await runSyncCycle(f.deps, config);
    expect(f.listMessages).toHaveBeenCalledTimes(2);
    expect(f.store.finish).toHaveBeenCalledExactlyOnceWith(
      claim,
      'SYNC_INVALID_PAGINATION',
    );
  });

  it('confirma ventanas sin mensajes', async () => {
    const f = fixture();
    f.listMessages.mockResolvedValue({ messages: [] });
    f.store.recordPage.mockResolvedValue(0);
    expect(await runSyncCycle(f.deps, config)).toEqual({
      completed: 1,
      failed: 0,
    });
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({ messagesDetected: 0 }),
    );
  });

  it('limita las cuentas por ciclo', async () => {
    const f = fixture();
    f.store.claim.mockReset().mockResolvedValue(claim);
    await runSyncCycle(f.deps, { ...config, maxAccountsPerCycle: 2 });
    expect(f.store.claim).toHaveBeenCalledTimes(2);
  });

  it('no reclama cuentas tras la señal de parada', async () => {
    const f = fixture();
    expect(await runSyncCycle(f.deps, config, AbortSignal.abort())).toEqual({
      completed: 0,
      failed: 0,
    });
    expect(f.store.claim).not.toHaveBeenCalled();
  });

  it('interrumpe entre páginas y libera la cuenta sin adelantar el cursor', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.listMessages.mockImplementationOnce(async () => {
      controller.abort();
      return { messages: [ref], nextPageToken: 'next' };
    });
    await runSyncCycle(f.deps, config, controller.signal);
    expect(f.store.recordPage).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledExactlyOnceWith(
      claim,
      'SYNC_STOPPED',
    );
  });

  it('espera entre ciclos, se recupera del fallo de descubrimiento y cancela la espera', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const controller = new AbortController();
    f.store.claim
      .mockReset()
      .mockRejectedValueOnce(new DataAccessError('UNAVAILABLE'))
      .mockResolvedValue(null);
    const running = runSyncWorker(f.deps, config, controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.claim).toHaveBeenCalledTimes(1);
    expect(f.deps.report).toHaveBeenCalledWith({
      type: 'SYNC_CYCLE_FAILED',
      errorCode: 'SYNC_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(f.store.claim).toHaveBeenCalledTimes(2);
    controller.abort();
    await running;
    expect(f.store.claim).toHaveBeenCalledTimes(2);
  });

  it('expone solamente categorías seguras de error', () => {
    expect(syncErrorCode(new Error('private-body token secret'))).toBe(
      'SYNC_UNAVAILABLE',
    );
    expect(syncErrorCode(new GmailCredentialError('REAUTH_REQUIRED'))).toBe(
      'SYNC_REAUTH_REQUIRED',
    );
  });
});
