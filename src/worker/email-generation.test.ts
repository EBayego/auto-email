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
});
