import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataClient } from '@/db/models';
import type { TextGenerationClient } from '@/providers/contracts';
import { DataAccessError } from '@/db/errors';
import { defaultResponsePolicySettings } from '@/modules/policy/settings';
import type { AutomationSnapshot } from '@/modules/workflow/automation-settings';
import {
  classifierMessage,
  classifierMetadata,
} from '../../tests/fixtures/classifier-emails';
import { createAccountEmailClassifier } from './email-classifier';
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
  const full = classifierMessage();
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
  const getMessage = vi.fn(
    async (_id: string, options?: { format?: string }) =>
      options?.format === 'metadata' ? classifierMetadata(full) : full,
  );
  const generate = vi.fn<TextGenerationClient['generate']>().mockResolvedValue({
    text: JSON.stringify({
      decision: 'REPLY_REQUIRED',
      intent: 'REQUEST_INFORMATION',
      reasons: ['EXPLICIT_QUESTION'],
      riskFlags: [],
      needsAttachment: false,
      confidence: 'HIGH',
    }),
    inputTokens: 100,
    outputTokens: 30,
  });
  const input = {
    client: {} as DataClient,
    work: { userId: crypto.randomUUID(), gmailAccountId: crypto.randomUUID() },
    gmail: { getMessage },
    text: { generate },
  };
  return { input, full, snapshot, getMessage, generate };
}
beforeEach(() => vi.resetAllMocks());
describe('MAIL-064 clasificador compuesto con configuración actual y MIME real', () => {
  it('normaliza el cuerpo, envía solo datos del mensaje seleccionado y conserva el uso real del modelo', async () => {
    const f = fixture(),
      classifier = await createAccountEmailClassifier(f.input);
    expect(await classifier.classify(f.full.id)).toMatchObject({
      decision: 'REPLY_REQUIRED',
      source: 'MODEL',
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 30,
    });
    expect(f.getMessage.mock.calls.map((call) => call[1]?.format)).toEqual([
      'metadata',
      'full',
    ]);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.generate.mock.calls[0][0].input).toContain('horario de atención');
    expect(f.generate.mock.calls[0][0].input).not.toContain(
      'owner@example.invalid',
    );
  });
  it.each([
    'stored-address',
    'extra-address',
    'stored-domain',
    'extra-domain',
  ] as const)(
    'combina exclusiones y evita leer el cuerpo: %s',
    async (kind) => {
      const f = fixture(),
        classifier = await createAccountEmailClassifier(f.input);
      if (kind === 'stored-address')
        f.snapshot.settings.excludedAddresses = ['contact@example.invalid'];
      if (kind === 'stored-domain')
        f.snapshot.settings.excludedDomains = ['example.invalid'];
      const result = await classifier.classify(
        f.full.id,
        kind === 'extra-address'
          ? { excludedAddresses: ['CONTACT@example.invalid'] }
          : kind === 'extra-domain'
            ? { excludedDomains: ['EXAMPLE.invalid'] }
            : {},
      );
      expect(result).toMatchObject({
        decision: 'NO_REPLY',
        source: 'RULE',
        modelCalls: 0,
      });
      expect(f.getMessage).toHaveBeenCalledTimes(1);
      expect(f.generate).not.toHaveBeenCalled();
    },
  );
  it('aplica la categoría bloqueada tras el modelo sin perder su contabilidad', async () => {
    const f = fixture();
    f.snapshot.settings.policy.blockedCategories = ['REQUEST_INFORMATION'];
    const classifier = await createAccountEmailClassifier(f.input);
    expect(await classifier.classify(f.full.id)).toMatchObject({
      decision: 'NO_REPLY',
      reasons: ['CATEGORY_EXCLUDED'],
      modelCalls: 1,
      inputTokens: 100,
      outputTokens: 30,
    });
  });
  it('no convierte una abstención del modelo en una exclusión categórica', async () => {
    const f = fixture();
    f.snapshot.settings.policy.blockedCategories = ['REQUEST_INFORMATION'];
    f.generate.mockResolvedValue({
      text: JSON.stringify({
        decision: 'UNCERTAIN',
        intent: 'REQUEST_INFORMATION',
        reasons: ['INSUFFICIENT_CONTEXT'],
        riskFlags: [],
        needsAttachment: false,
        confidence: 'LOW',
      }),
      inputTokens: 100,
      outputTokens: 30,
    });
    expect(
      (await (await createAccountEmailClassifier(f.input)).classify(f.full.id))
        .decision,
    ).toBe('UNCERTAIN');
  });
  it('vuelve a comprobar el estado de cuenta y las exclusiones en cada clasificación', async () => {
    const f = fixture(),
      classifier = await createAccountEmailClassifier(f.input);
    await classifier.classify(f.full.id);
    f.snapshot.settings.excludedDomains = ['example.invalid'];
    expect((await classifier.classify(f.full.id)).decision).toBe('NO_REPLY');
    mocks.account.mockResolvedValue({ status: 'PAUSED' });
    await expect(classifier.classify(f.full.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('los fallos de propietario y configuración se cierran antes de leer Gmail', async () => {
    const f = fixture();
    mocks.open.mockRejectedValueOnce(new DataAccessError('NOT_FOUND'));
    await expect(createAccountEmailClassifier(f.input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const classifier = await createAccountEmailClassifier(f.input);
    mocks.configuration.mockRejectedValueOnce(
      new DataAccessError('UNAVAILABLE'),
    );
    await expect(classifier.classify(f.full.id)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(f.getMessage).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });
});
