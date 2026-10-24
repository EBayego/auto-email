import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailClassification } from '@/modules/classifier/contracts';
import { ProviderError } from '@/providers/errors';
import { EmailJobError, jobClassification } from '@/modules/workflow/email-job';
import {
  runEmailJobCycle,
  type EmailJob,
  type EmailJobStore,
  type EmailJobDependencies,
} from './email-jobs';

const config = { leaseSeconds: 300, maxJobsPerCycle: 10 };
const job: EmailJob = {
  id: '00000000-0000-4000-8000-000000000031',
  userId: '00000000-0000-4000-8000-000000000032',
  gmailAccountId: '00000000-0000-4000-8000-000000000033',
  targetMessageId: 'm1',
  threadId: 't1',
  status: 'CLASSIFYING',
  leaseId: '00000000-0000-4000-8000-000000000034',
  classification: null,
  draftId: null,
};
const classified: EmailClassification = {
  decision: 'REPLY_REQUIRED',
  intent: 'REQUEST_INFORMATION',
  reasons: ['EXPLICIT_QUESTION'],
  explanation: 'Pregunta.',
  riskFlags: [],
  needsAttachment: false,
  source: 'MODEL',
  modelCalls: 1,
  inputTokens: 12,
  outputTokens: 4,
};
function fixture(result: EmailClassification = classified) {
  const store = {
    claim: vi
      .fn<EmailJobStore['claim']>()
      .mockResolvedValueOnce(job)
      .mockResolvedValue(null),
    renew: vi.fn<EmailJobStore['renew']>().mockResolvedValue(true),
    advance: vi
      .fn<EmailJobStore['advance']>()
      .mockImplementation(async (current, outcome) => ({
        ...current,
        ...outcome,
        leaseId: null,
      })),
    recover: vi.fn<EmailJobStore['recover']>().mockResolvedValue(0),
  };
  const classify = vi.fn(async () => result);
  const deps: EmailJobDependencies = {
    store,
    inspect: vi
      .fn<EmailJobDependencies['inspect']>()
      .mockResolvedValue({ status: 'CONTINUE' }),
    classifierFor: vi.fn(async () => ({ classify })),
    report: vi.fn(),
  };
  return { deps, store, classify };
}
afterEach(() => vi.useRealTimers());

describe('MAIL-031 consumo de la cola', () => {
  it('deja pendiente una clasificación cancelada durante una espera de cuota', async () => {
    const f = fixture();
    const controller = new AbortController();
    vi.mocked(f.deps.inspect).mockImplementation(async () => {
      controller.abort();
      throw new ProviderError('google', 'CANCELLED');
    });
    expect(
      await runEmailJobCycle(f.deps, config, controller.signal),
    ).toMatchObject({ failed: 0, claimed: 1 });
    expect(f.store.advance).toHaveBeenCalledWith(job, {
      status: 'PENDING',
      reasonCode: 'WORKER_STOPPED',
    });
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        reasonCode: 'WORKER_STOPPED',
      }),
    );
  });
  it.each([
    { status: 'SKIPPED', reasonCode: 'EXISTING_MANUAL_DRAFT' },
    { status: 'SKIPPED', reasonCode: 'ALREADY_ANSWERED' },
    { status: 'REVIEW_REQUIRED', reasonCode: 'DRAFT_RECONCILIATION_REQUIRED' },
  ] as const)(
    'omite llamadas al clasificador al detectar $reasonCode',
    async (inspection) => {
      const f = fixture();
      vi.mocked(f.deps.inspect).mockResolvedValue(inspection);
      expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
        classified: 0,
        failed: 0,
      });
      expect(f.classify).not.toHaveBeenCalled();
      expect(f.deps.classifierFor).not.toHaveBeenCalled();
      expect(f.store.advance).toHaveBeenCalledExactlyOnceWith(job, inspection);
    },
  );
  it('vuelve a comprobar Gmail antes de reanudar la generación', async () => {
    const f = fixture();
    const generating = {
      ...job,
      status: 'GENERATING' as const,
      classification: jobClassification(classified),
    };
    f.store.claim
      .mockReset()
      .mockResolvedValueOnce(generating)
      .mockResolvedValue(null);
    vi.mocked(f.deps.inspect).mockResolvedValue({
      status: 'SKIPPED',
      reasonCode: 'EXISTING_MANUAL_DRAFT',
    });
    f.deps.generate = vi.fn();
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      skipped: 1,
      classified: 0,
      draftsCreated: 0,
    });
    expect(f.deps.generate).not.toHaveBeenCalled();
    expect(f.store.advance).toHaveBeenCalledWith(generating, {
      status: 'SKIPPED',
      reasonCode: 'EXISTING_MANUAL_DRAFT',
    });
  });
  it('no interpreta un error al comprobar Gmail como permiso para continuar', async () => {
    const f = fixture();
    vi.mocked(f.deps.inspect).mockRejectedValue(
      new ProviderError('google', 'UNAVAILABLE'),
    );
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      failed: 1,
      classified: 0,
    });
    expect(f.classify).not.toHaveBeenCalled();
    expect(f.store.advance).toHaveBeenCalledWith(job, {
      status: 'FAILED',
      reasonCode: 'JOB_UNAVAILABLE',
    });
  });
  it('conserva la clasificación completada y deja la generación pendiente', async () => {
    const f = fixture();
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      claimed: 1,
      classified: 1,
      awaitingGeneration: 1,
      failed: 0,
    });
    expect(f.store.claim).toHaveBeenCalledWith(300, false);
    expect(f.store.advance).toHaveBeenCalledWith(
      job,
      expect.objectContaining({
        status: 'GENERATING',
        classification: expect.objectContaining({ decision: 'REPLY_REQUIRED' }),
      }),
    );
    expect(f.store.advance.mock.calls[0][1].classification).not.toHaveProperty(
      'explanation',
    );
  });
  it.each([
    { decision: 'NO_REPLY', expected: 'SKIPPED' },
    { decision: 'UNCERTAIN', expected: 'REVIEW_REQUIRED' },
  ] as const)(
    'transforma $decision en $expected',
    async ({ decision, expected }) => {
      const f = fixture({ ...classified, decision });
      await runEmailJobCycle(f.deps, config);
      expect(f.store.advance).toHaveBeenCalledWith(
        job,
        expect.objectContaining({ status: expected }),
      );
    },
  );
  it.each(['MODEL_UNAVAILABLE', 'INVALID_MODEL_RESPONSE'] as const)(
    'registra %s como fallo recuperable explícitamente',
    async (reason) => {
      const f = fixture({
        ...classified,
        decision: 'UNCERTAIN',
        reasons: [reason],
      });
      expect((await runEmailJobCycle(f.deps, config)).failed).toBe(1);
      expect(f.store.advance).toHaveBeenCalledExactlyOnceWith(job, {
        status: 'FAILED',
        reasonCode: reason,
      });
    },
  );
  it('un error de un proveedor no detiene otros trabajos', async () => {
    const f = fixture();
    f.store.claim
      .mockReset()
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({ ...job, id: 'other-job' })
      .mockResolvedValue(null);
    f.classify.mockRejectedValueOnce(
      new ProviderError('google', 'UNAVAILABLE'),
    );
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      failed: 1,
      classified: 1,
      claimed: 2,
    });
  });
  it('no ejecuta acciones cuando el lease se perdió', async () => {
    const f = fixture();
    f.store.renew.mockResolvedValue(false);
    expect((await runEmailJobCycle(f.deps, config)).failed).toBe(1);
    expect(f.classify).not.toHaveBeenCalled();
    expect(f.store.advance).not.toHaveBeenCalled();
  });
  it('no publica un resultado de clasificación con un lease obsoleto', async () => {
    const f = fixture();
    f.store.renew
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    await runEmailJobCycle(f.deps, config);
    expect(f.classify).toHaveBeenCalledOnce();
    expect(f.store.advance).not.toHaveBeenCalled();
  });
  it('recupera trabajos antes de reclamar otros y respeta el límite por ciclo', async () => {
    const f = fixture();
    f.store.recover.mockResolvedValue(2);
    f.store.claim.mockReset().mockResolvedValue(job);
    expect(
      await runEmailJobCycle(f.deps, { ...config, maxJobsPerCycle: 2 }),
    ).toMatchObject({ claimed: 2, recovered: 2 });
    expect(f.store.recover.mock.invocationCallOrder[0]).toBeLessThan(
      f.store.claim.mock.invocationCallOrder[0],
    );
  });
  it('no trabaja después de una señal de parada', async () => {
    const f = fixture();
    await runEmailJobCycle(f.deps, config, AbortSignal.abort());
    expect(f.store.claim).not.toHaveBeenCalled();
    expect(f.store.recover).not.toHaveBeenCalled();
  });
  it('renueva el lease durante una clasificación larga', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finish!: (value: EmailClassification) => void;
    f.classify.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const running = runEmailJobCycle(f.deps, config);
    await vi.advanceTimersByTimeAsync(100001);
    expect(f.store.renew).toHaveBeenCalledTimes(3);
    finish(classified);
    await running;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reanuda la generación con la clasificación persistida y sin volver a clasificar', async () => {
    const f = fixture();
    const classification = jobClassification(classified);
    const generating = {
      ...job,
      status: 'GENERATING' as const,
      classification,
    };
    f.store.claim
      .mockReset()
      .mockResolvedValueOnce(generating)
      .mockResolvedValue(null);
    f.deps.generate = vi.fn<NonNullable<EmailJobDependencies['generate']>>(
      async (_current, control) => {
        await control.assertLease();
        return { status: 'DRAFT_CREATED', draftId: 'draft_1' };
      },
    );
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      draftsCreated: 1,
      classified: 0,
    });
    expect(f.classify).not.toHaveBeenCalled();
    expect(f.store.claim).toHaveBeenCalledWith(300, true);
    expect(f.store.advance).toHaveBeenCalledWith(generating, {
      status: 'DRAFT_CREATED',
      draftId: 'draft_1',
    });
  });
  it('no repite la escritura si el resultado de la generación es incierto', async () => {
    const f = fixture();
    f.store.claim
      .mockReset()
      .mockResolvedValueOnce({ ...job, status: 'GENERATING' })
      .mockResolvedValue(null);
    const generate = vi.fn(async () => {
      throw new Error('private-email-body');
    });
    f.deps.generate = generate;
    expect(await runEmailJobCycle(f.deps, config)).toMatchObject({
      reviewRequired: 1,
      draftsCreated: 0,
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(f.store.advance).toHaveBeenCalledWith(expect.anything(), {
      status: 'REVIEW_REQUIRED',
      reasonCode: 'GENERATION_OUTCOME_UNKNOWN',
    });
    expect(JSON.stringify(vi.mocked(f.deps.report).mock.calls)).not.toContain(
      'private-email-body',
    );
  });
  it('un fallo al persistir resultados deja el trabajo recuperable por expiración', async () => {
    const f = fixture();
    f.store.advance.mockRejectedValue(new EmailJobError('LEASE_LOST'));
    expect((await runEmailJobCycle(f.deps, config)).failed).toBe(1);
    expect(f.deps.report).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'JOB_PROCESSING_FAILED' }),
    );
  });
});
