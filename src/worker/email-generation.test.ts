import { describe, expect, it, vi } from 'vitest';
import { generateEmailJobDraft } from './email-generation';
import { createResponseGenerator } from '@/modules/response/generator';
import { draftFixture } from '../../tests/fixtures/drafts';
import type { EmailJob } from './email-jobs';

function fixture() {
  const f = draftFixture();
  const job: EmailJob = {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    gmailAccountId: f.selection.accountId,
    targetMessageId: f.thread.messages[0].id,
    threadId: f.thread.id,
    status: 'GENERATING',
    leaseId: crypto.randomUUID(),
    draftId: null,
    classification: {
      decision: 'REPLY_REQUIRED',
      intent: 'CONFIRMATION',
      reasons: ['EXPLICIT_QUESTION'],
      riskFlags: [],
      needsAttachment: false,
      source: 'MODEL',
      modelCalls: 1,
      inputTokens: 1,
      outputTokens: 1,
    },
  };
  const writer = {
    create: vi
      .fn()
      .mockResolvedValue({ status: 'DRAFT_CREATED', draftId: 'draft48' }),
  };
  const assertLease = vi.fn().mockResolvedValue(undefined);
  const input = {
    ...f,
    job,
    writer,
    assertLease,
    orchestration: {
      gmail: f.gmail,
      generator: createResponseGenerator(f.text),
      styleExamples: { retrieve: vi.fn().mockResolvedValue([]) },
    },
  };
  return { f, input };
}
describe('MAIL-048 generación en el worker', () => {
  it('MAIL-057 evita generar si otra ejecución confirma un envío entre las dos comprobaciones', async () => {
    const { f, input } = fixture();
    f.store.find.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: crypto.randomUUID(),
      threadId: input.job.threadId,
      targetMessageId: input.job.targetMessageId,
      status: 'UNCERTAIN',
      draftId: null,
      draftMessageId: null,
      verified: false,
      sent: true,
    });
    expect(await generateEmailJobDraft(input)).toEqual({
      status: 'SKIPPED',
      reasonCode: 'ALREADY_ANSWERED',
    });
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(input.writer.create).not.toHaveBeenCalled();
  });
  it('conecta selección, generación, doble verificación y escritor con lease', async () => {
    const { f, input } = fixture();
    expect(await generateEmailJobDraft(input)).toEqual({
      status: 'DRAFT_CREATED',
      draftId: 'draft48',
    });
    expect(f.text.generate).toHaveBeenCalledTimes(2);
    expect(input.assertLease).toHaveBeenCalledTimes(3);
    expect(input.writer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: f.model,
        response: expect.objectContaining({
          status: 'READY',
          factualValidation: expect.objectContaining({ status: 'SUPPORTED' }),
        }),
      }),
    );
  });
  it.each(['CREATING', 'UNCERTAIN', 'CANCELLED', 'CREATED'] as const)(
    'comprueba idempotencia antes de modelo y Gmail: %s',
    async (status) => {
      const { f, input } = fixture();
      f.rows.push({
        id: crypto.randomUUID(),
        threadId: input.job.threadId,
        targetMessageId: input.job.targetMessageId,
        status,
        draftId: status === 'CREATED' ? 'existing48' : null,
        draftMessageId: null,
        verified: false,
      });
      expect(await generateEmailJobDraft(input)).toMatchObject(
        status === 'CREATED'
          ? { status: 'DRAFT_CREATED', draftId: 'existing48' }
          : { status: 'REVIEW_REQUIRED' },
      );
      expect(f.gmail.getThread).not.toHaveBeenCalled();
      expect(f.text.generate).not.toHaveBeenCalled();
      expect(input.writer.create).not.toHaveBeenCalled();
    },
  );
  it('un borrador manual impide generar y no se modifica', async () => {
    const { f, input } = fixture();
    f.gmail.getThread.mockResolvedValue({
      ...f.thread,
      messages: [
        ...f.thread.messages,
        { ...f.thread.messages[0], id: 'manual48', labelIds: ['DRAFT'] },
      ],
    });
    expect(await generateEmailJobDraft(input)).toEqual({
      status: 'SKIPPED',
      reasonCode: 'EXISTING_MANUAL_DRAFT',
    });
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(input.writer.create).not.toHaveBeenCalled();
  });
  it('pierde el lease al terminar el modelo y nunca llega a escribir', async () => {
    const { input } = fixture();
    input.assertLease
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('LEASE_LOST'));
    await expect(generateEmailJobDraft(input)).rejects.toThrow('LEASE_LOST');
    expect(input.writer.create).not.toHaveBeenCalled();
  });
  it('no genera sin perfil confirmado', async () => {
    const { f, input } = fixture();
    expect(
      await generateEmailJobDraft({
        ...input,
        selection: { ...input.selection, style: undefined },
      }),
    ).toEqual({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'STYLE_PROFILE_REQUIRED',
    });
    expect(f.text.generate).not.toHaveBeenCalled();
  });
  it.each(['before_selection', 'before_model', 'before_write'] as const)(
    'respeta una parada en %s sin escribir un borrador',
    async (phase) => {
      const { f, input } = fixture(),
        controller = new AbortController();
      if (phase === 'before_selection') controller.abort();
      if (phase === 'before_model')
        input.assertLease.mockImplementation(async () => {
          if (input.assertLease.mock.calls.length === 2) controller.abort();
        });
      if (phase === 'before_write')
        input.assertLease.mockImplementation(async () => {
          if (input.assertLease.mock.calls.length === 3) controller.abort();
        });
      expect(
        await generateEmailJobDraft({ ...input, signal: controller.signal }),
      ).toEqual({ status: 'REVIEW_REQUIRED', reasonCode: 'WORKER_STOPPED' });
      expect(input.writer.create).not.toHaveBeenCalled();
      expect(f.text.generate).toHaveBeenCalledTimes(
        phase === 'before_write' ? 2 : 0,
      );
    },
  );
  it.each(['status', 'lease', 'classification'] as const)(
    'rechaza un trabajo inválido por %s antes de cualquier acceso',
    async (kind) => {
      const { f, input } = fixture();
      const job: EmailJob = {
        ...input.job,
        ...(kind === 'status'
          ? { status: 'PENDING' }
          : kind === 'lease'
            ? { leaseId: null }
            : { classification: null }),
      };
      await expect(generateEmailJobDraft({ ...input, job })).rejects.toThrow(
        'INVALID_GENERATION_JOB',
      );
      expect(input.assertLease).not.toHaveBeenCalled();
      expect(f.store.find).not.toHaveBeenCalled();
      expect(f.text.generate).not.toHaveBeenCalled();
      expect(input.writer.create).not.toHaveBeenCalled();
    },
  );
  it('una respuesta ya enviada o un objetivo sustituido evitan llamar al modelo', async () => {
    for (const kind of ['answered', 'superseded'] as const) {
      const { f, input } = fixture();
      const source = f.thread.messages[0],
        id = kind === 'answered' ? 'sent64' : 'newIncoming64';
      const latest = {
        ...source,
        id,
        internalDate: String(Number(source.internalDate) + 60000),
        labelIds: kind === 'answered' ? ['SENT'] : source.labelIds,
        payload: {
          ...source.payload,
          headers: [
            ...source.payload!.headers!.map((h) =>
              h.name.toLowerCase() === 'message-id'
                ? { ...h, value: `<${id}@example.invalid>` }
                : kind === 'answered' && h.name.toLowerCase() === 'from'
                  ? { ...h, value: 'owner@example.invalid' }
                  : kind === 'answered' && h.name.toLowerCase() === 'to'
                    ? { ...h, value: 'contact@example.invalid' }
                    : h,
            ),
            ...(kind === 'answered'
              ? [
                  {
                    name: 'In-Reply-To',
                    value: `<${input.job.targetMessageId}@example.invalid>`,
                  },
                ]
              : []),
          ],
        },
      };
      f.gmail.getThread.mockResolvedValue({
        ...f.thread,
        messages: [...f.thread.messages, latest],
      });
      expect(await generateEmailJobDraft(input)).toEqual({
        status: 'SKIPPED',
        reasonCode:
          kind === 'answered' ? 'ALREADY_ANSWERED' : 'TARGET_SUPERSEDED',
      });
      expect(f.text.generate).not.toHaveBeenCalled();
      expect(input.writer.create).not.toHaveBeenCalled();
    }
  });
  it('una abstención del generador conserva la causa y no llega al escritor', async () => {
    const { input } = fixture();
    const generate = vi.fn().mockResolvedValue({
      status: 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      language: 'es',
      missingInformation: [],
      evidence: [],
      warnings: ['HUMAN_REVIEW_REQUIRED'],
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      examplesUsed: 0,
      sourcesUsed: [],
    });
    expect(
      await generateEmailJobDraft({
        ...input,
        orchestration: { ...input.orchestration, generator: { generate } },
      }),
    ).toEqual({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'RESPONSE_REQUIRES_REVIEW',
    });
    expect(input.writer.create).not.toHaveBeenCalled();
  });
});
