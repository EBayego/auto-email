import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataClient } from '@/db/models';
import { DataAccessError } from '@/db/errors';
import { defaultResponsePolicySettings } from '@/modules/policy/settings';
import type { AutomationSnapshot } from '@/modules/workflow/automation-settings';
import {
  classifierMessage,
  classifierMetadata,
} from '../../tests/fixtures/classifier-emails';
import { inspectAutomationSelection } from './automation-selection';
const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  account: vi.fn(),
  configuration: vi.fn(),
}));
vi.mock('./data-access', () => ({ openWorkerDataAccess: mocks.open }));
vi.mock('@/db/automation-settings', () => ({
  createAutomationSettingsRepository: () => ({ get: mocks.configuration }),
}));
function fixture() {
  const message = classifierMetadata(classifierMessage());
  const snapshot: AutomationSnapshot = {
    revision: 'a'.repeat(32),
    settings: {
      execution: {
        automationEnabled: true,
        pollIntervalSeconds: 300,
        maxDailyDrafts: 30,
      },
      processingScope: 'INBOX',
      excludedAddresses: [],
      excludedDomains: [],
      policy: defaultResponsePolicySettings(),
    },
  };
  mocks.open.mockResolvedValue({ getAccount: mocks.account });
  mocks.account.mockResolvedValue({
    email: 'owner@example.invalid',
    status: 'CONNECTED',
  });
  mocks.configuration.mockResolvedValue(snapshot);
  const getMessage = vi.fn(async () => message);
  const input = {
    client: {} as DataClient,
    work: { userId: crypto.randomUUID(), gmailAccountId: crypto.randomUUID() },
    gmail: { getMessage },
    messageId: message.id,
  };
  return { input, getMessage, snapshot, message };
}
beforeEach(() => vi.resetAllMocks());
describe('MAIL-064 selección del worker antes de consultar el cuerpo o escribir', () => {
  it('ALL_INCOMING sin exclusiones no necesita leer contenido ni metadatos', async () => {
    const f = fixture();
    f.snapshot.settings.processingScope = 'ALL_INCOMING';
    expect(await inspectAutomationSelection(f.input)).toEqual({
      revision: f.snapshot.revision,
      reason: null,
    });
    expect(f.getMessage).not.toHaveBeenCalled();
  });
  it('una categoría excluida detiene el trabajo antes de otra lectura Gmail', async () => {
    const f = fixture();
    f.snapshot.settings.policy.blockedCategories = ['REQUEST_INFORMATION'];
    expect(
      await inspectAutomationSelection({
        ...f.input,
        classification: {
          decision: 'REPLY_REQUIRED',
          intent: 'REQUEST_INFORMATION',
          reasons: ['EXPLICIT_QUESTION'],
          riskFlags: [],
          needsAttachment: false,
          source: 'MODEL',
          modelCalls: 1,
          inputTokens: 1,
          outputTokens: 1,
        },
      }),
    ).toEqual({ revision: f.snapshot.revision, reason: 'CATEGORY_EXCLUDED' });
    expect(f.getMessage).not.toHaveBeenCalled();
  });
  it.each([
    ['INBOX', ['INBOX'], null],
    ['INBOX', [], 'OUTSIDE_SELECTION'],
    ['UNREAD_INBOX', ['INBOX'], 'OUTSIDE_SELECTION'],
    ['UNREAD_INBOX', ['INBOX', 'UNREAD'], null],
    ['INBOX', ['INBOX', 'SPAM'], 'SPAM'],
    ['INBOX', ['INBOX', 'TRASH'], 'TRASH'],
  ] as const)(
    'revalida alcance %s y etiquetas %j: %s',
    async (scope, labels, reason) => {
      const f = fixture();
      f.snapshot.settings.processingScope = scope;
      f.getMessage.mockResolvedValue({ ...f.message, labelIds: [...labels] });
      expect(await inspectAutomationSelection(f.input)).toEqual({
        revision: f.snapshot.revision,
        reason,
      });
      expect(f.getMessage).toHaveBeenCalledWith(
        f.message.id,
        expect.objectContaining({ format: 'metadata' }),
      );
    },
  );
  it.each(['address', 'domain'] as const)(
    'aplica la exclusión actual de %s incluso con ALL_INCOMING',
    async (kind) => {
      const f = fixture();
      f.snapshot.settings.processingScope = 'ALL_INCOMING';
      if (kind === 'address')
        f.snapshot.settings.excludedAddresses = ['contact@example.invalid'];
      else f.snapshot.settings.excludedDomains = ['example.invalid'];
      expect((await inspectAutomationSelection(f.input)).reason).toBe(
        kind === 'address' ? 'EXCLUDED_SENDER' : 'EXCLUDED_DOMAIN',
      );
      expect(f.getMessage).toHaveBeenCalledTimes(1);
    },
  );
  it('rechaza una respuesta Gmail que contiene otro mensaje', async () => {
    const f = fixture();
    f.getMessage.mockResolvedValue({ ...f.message, id: 'foreignMessage' });
    await expect(inspectAutomationSelection(f.input)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });
  it.each(['PAUSED', 'DISCONNECTED', 'REAUTH_REQUIRED'])(
    'no lee Gmail con una cuenta %s',
    async (status) => {
      const f = fixture();
      mocks.account.mockResolvedValue({
        status,
        email: 'owner@example.invalid',
      });
      await expect(inspectAutomationSelection(f.input)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(mocks.configuration).not.toHaveBeenCalled();
      expect(f.getMessage).not.toHaveBeenCalled();
    },
  );
  it('el fallo de autorización o configuración impide consultar al proveedor', async () => {
    const f = fixture();
    mocks.open.mockRejectedValueOnce(new DataAccessError('FORBIDDEN'));
    await expect(inspectAutomationSelection(f.input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    mocks.configuration.mockRejectedValueOnce(
      new DataAccessError('UNAVAILABLE'),
    );
    await expect(inspectAutomationSelection(f.input)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(f.getMessage).not.toHaveBeenCalled();
  });
});
