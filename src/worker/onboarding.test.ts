import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runOnboardingAnalysis } from './onboarding';
import { OnboardingError } from '@/modules/identity/onboarding';
import { ProviderError } from '@/providers/errors';
import { DataAccessError } from '@/db/errors';
import { writingProfileFixture } from '../../tests/fixtures/writing-profile';
import {
  sentMailbox,
  sentEmail,
  sampleOwner,
} from '../../tests/fixtures/sent-emails';
import type { AnalysisJob } from '@/db/onboarding';

const job = {
  user_id: crypto.randomUUID(),
  gmail_account_id: crypto.randomUUID(),
  lease_id: crypto.randomUUID(),
  consent_version: 'mail051-v1',
  scope: {
    after: '2026-01-01',
    before: '2026-10-18',
    maxCandidates: 200,
    excludedAddresses: [],
    excludedDomains: [],
  },
} as unknown as AnalysisJob;
const claim = vi.fn(),
  advance = vi.fn(),
  finish = vi.fn(),
  clientsFor = vi.fn();
const report = vi.fn();
const generate = vi.fn();
const gmail = sentMailbox([sentEmail(0), sentEmail(1), sentEmail(2)]);
const run = () =>
  runOnboardingAnalysis({
    store: { claim, advance, finish },
    clientsFor,
    report,
  });
describe('MAIL-051 análisis de historial en el worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claim.mockResolvedValue(job);
    advance.mockResolvedValue(undefined);
    finish.mockResolvedValue(undefined);
    generate.mockResolvedValue({
      text: JSON.stringify(writingProfileFixture()),
      inputTokens: 120,
      outputTokens: 90,
    });
    clientsFor.mockResolvedValue({
      gmail,
      text: { generate },
      mailboxAddress: sampleOwner,
      model: 'test-model',
    });
  });
  it('no llama a proveedores si no hay una solicitud explícita', async () => {
    claim.mockResolvedValue(null);
    expect(await run()).toEqual({ failed: false });
    expect(clientsFor).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
  it('rechaza una solicitud sin la versión de consentimiento vigente', async () => {
    claim.mockResolvedValue({ ...job, consent_version: 'old' });
    expect(await run()).toEqual({ failed: false });
    expect(clientsFor).not.toHaveBeenCalled();
  });
  it('crea un perfil con una muestra efímera y guarda solo datos derivados y referencias', async () => {
    expect(await run()).toEqual({ failed: false });
    expect(generate).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(job, {
      generation: expect.objectContaining({
        sampleSize: 3,
        sourceMessageIds: expect.arrayContaining(['sent0', 'sent1', 'sent2']),
        warnings: ['BELOW_RECOMMENDED_SIZE'],
      }),
    });
    const saved = JSON.stringify(finish.mock.calls);
    expect(saved).not.toContain('he revisado la propuesta del proyecto');
    expect(saved).not.toContain('contact0@example.invalid');
    expect(advance).toHaveBeenCalledWith(job, 'ANALYZING', 3, 3);
    for (const [options] of gmail.listMessages.mock.calls)
      expect(options).toMatchObject({ mailbox: 'sent' });
  });
  it('no empieza lecturas si la autorización de la ejecución ha cambiado', async () => {
    advance.mockRejectedValue(new OnboardingError('CANCELLED'));
    expect(await run()).toEqual({ failed: false });
    expect(clientsFor).not.toHaveBeenCalled();
  });
  it('descarta un resultado si se cancela durante la llamada al modelo', async () => {
    let cancelled = false;
    advance.mockImplementation(async () => {
      if (cancelled) throw new OnboardingError('CANCELLED');
    });
    generate.mockImplementation(async () => {
      cancelled = true;
      return {
        text: JSON.stringify(writingProfileFixture()),
        inputTokens: 12,
        outputTokens: 9,
      };
    });
    expect(await run()).toEqual({ failed: false });
    expect(finish.mock.calls.some(([, result]) => 'generation' in result)).toBe(
      false,
    );
  });
  it('informa de una muestra vacía sin llamar al modelo', async () => {
    clientsFor.mockResolvedValue({
      gmail: sentMailbox([]),
      text: { generate },
      mailboxAddress: sampleOwner,
      model: 'test-model',
    });
    expect(await run()).toEqual({ failed: true });
    expect(generate).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(job, { error: 'EMPTY_SAMPLE' });
  });
  it('mapea falta de permisos sin exponer el contenido del error', async () => {
    clientsFor.mockRejectedValue(
      new ProviderError('google', 'PERMISSION_DENIED'),
    );
    expect(await run()).toEqual({ failed: true });
    expect(finish).toHaveBeenCalledWith(job, { error: 'REAUTH_REQUIRED' });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: 'REAUTH_REQUIRED',
        errorCode: 'PERMISSION_DENIED',
        provider: 'google',
        phase: 'SAMPLING',
      }),
    );
  });
  it('identifica el fallo de almacenamiento y conserva los contadores sin contenido privado', async () => {
    advance.mockRejectedValueOnce(new DataAccessError('UNAVAILABLE'));
    expect(await run()).toEqual({ failed: true });
    expect(report).toHaveBeenCalledWith({
      type: 'ONBOARDING_FAILED',
      reasonCode: 'UNAVAILABLE',
      errorCode: 'DATABASE_UNAVAILABLE',
      phase: 'SAMPLING',
      scanned: 0,
      selected: 0,
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it('distingue el fallo al guardar un perfil de la preparación de la muestra', async () => {
    finish.mockRejectedValueOnce(new DataAccessError('UNAVAILABLE'));
    expect(await run()).toEqual({ failed: true });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ONBOARDING_FAILED',
        errorCode: 'DATABASE_UNAVAILABLE',
        phase: 'SAVING',
        scanned: 3,
        selected: 3,
      }),
    );
  });
  it('aplica las exclusiones antes de leer el cuerpo y generar el perfil', async () => {
    advance.mockResolvedValue(undefined);
    claim.mockResolvedValue({
      ...job,
      scope: {
        ...(job.scope as object),
        excludedAddresses: ['contact0@example.invalid'],
      },
    });
    expect(await run()).toEqual({ failed: false });
    expect(
      gmail.getMessage.mock.calls.some(
        ([id, options]) => id === 'sent0' && options?.format === 'full',
      ),
    ).toBe(false);
    expect(finish).toHaveBeenCalledWith(expect.anything(), {
      generation: expect.objectContaining({ sampleSize: 2 }),
    });
  });
});
