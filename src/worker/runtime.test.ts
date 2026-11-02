import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretValue, type ServerConfig } from '@/config/env';
import { DataAccessError } from '@/db/errors';
import { createWorkerRuntime } from './runtime';
import { runSentDraftTracking } from './sent-draft-tracking';
import { runReplyComparisons } from './reply-comparisons';
import { runStyleLearning } from './style-learning';
import { createProviderRequestGate } from '@/db/provider-request-gate';
import { openWorkerDataAccess } from './data-access';
const mocks = vi.hoisted(() => ({
  gmail: {
    get: vi.fn(),
    getThread: vi.fn(),
    getMessage: vi.fn(),
    createDraft: vi.fn(),
  },
  connection: vi.fn(),
}));
vi.mock('@/db/service-client', () => ({
  createServiceDataClient: vi.fn(() => ({})),
}));
vi.mock('@/providers/runtime', () => ({
  createProviderClients: vi.fn(() => ({})),
}));
vi.mock('@/db/provider-request-gate', () => ({
  createProviderRequestGate: vi.fn(() => ({})),
}));
vi.mock('@/db/gmail-credential-repository', () => ({
  createGmailCredentialRepository: vi.fn(() => ({})),
}));
vi.mock('@/modules/gmail/credentials', () => ({
  createGmailConnection: mocks.connection,
}));
vi.mock('./data-access', () => ({
  openWorkerDataAccess: vi.fn(async () => ({})),
}));
vi.mock('./draft-reconciliation', () => ({ runDraftReconciliation: vi.fn() }));
vi.mock('./sent-draft-tracking', () => ({ runSentDraftTracking: vi.fn() }));
vi.mock('./reply-comparisons', () => ({ runReplyComparisons: vi.fn() }));
vi.mock('./style-learning', () => ({ runStyleLearning: vi.fn() }));
vi.mock('@/db/account-deletion-runtime', () => ({
  createAccountDeletionRuntime: vi.fn(),
}));
const work = {
  userId: '00000000-0000-4000-8000-000000000057',
  gmailAccountId: '10000000-0000-4000-8000-000000000057',
};
const config = {
  providerMode: 'live',
  environment: 'development',
  timeoutMs: 30000,
  gmail: { tokenEncryptionKey: new SecretValue('test') },
  openai: { model: 'test-model' },
} as unknown as ServerConfig;
describe('MAIL-057 capacidades del runtime para seguimiento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.mockReturnValue({ client: mocks.gmail });
  });
  it('el seguimiento funciona sin automatización y expone exclusivamente lecturas Gmail', async () => {
    const runtime = createWorkerRuntime(config, undefined, {
      enforceExecution: true,
    });
    await runtime.reconcileDrafts(20);
    expect(runReplyComparisons).toHaveBeenCalledTimes(1);
    expect(runStyleLearning).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(runStyleLearning).mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      vi.mocked(runReplyComparisons).mock.invocationCallOrder[0],
    );
    expect(
      vi.mocked(runReplyComparisons).mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      vi.mocked(runSentDraftTracking).mock.invocationCallOrder[0],
    );
    const callback = vi.mocked(runSentDraftTracking).mock.calls[0][0].gmailFor;
    const readonly = await callback(work as Parameters<typeof callback>[0]);
    expect(Object.keys(readonly).sort()).toEqual([
      'get',
      'getMessage',
      'getThread',
    ]);
    expect(vi.mocked(createProviderRequestGate).mock.calls.at(-1)).toEqual([
      expect.anything(),
      work,
      false,
    ]);
    await runtime.gmailFor(work);
    expect(vi.mocked(createProviderRequestGate).mock.calls.at(-1)).toEqual([
      expect.anything(),
      work,
      true,
    ]);
    expect(mocks.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('un usuario sin acceso sigue sin obtener el cliente de seguimiento', async () => {
    const runtime = createWorkerRuntime(config, undefined, {
      enforceExecution: true,
    });
    await runtime.reconcileDrafts(20);
    const callback = vi.mocked(runSentDraftTracking).mock.calls[0][0].gmailFor;
    vi.mocked(openWorkerDataAccess).mockRejectedValueOnce(
      new DataAccessError('FORBIDDEN'),
    );
    await expect(
      callback(work as Parameters<typeof callback>[0]),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.connection).not.toHaveBeenCalled();
  });
});
