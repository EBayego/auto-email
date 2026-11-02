import { describe, expect, it, vi } from 'vitest';
import { compareSentReply, runReplyComparisons } from './reply-comparisons';
import type { ReplyComparisonTask } from '@/modules/analytics/comparison-work';
import {
  sentDraftFixture,
  withSentHeader,
} from '../../tests/fixtures/sent-drafts';
import { ProviderError } from '@/providers/errors';
function fixture() {
  const f = sentDraftFixture();
  const task: ReplyComparisonTask = {
    id: crypto.randomUUID(),
    userId: f.attempt.userId,
    gmailAccountId: f.attempt.gmailAccountId,
    draftGenerationId: f.attempt.id,
    generationRunId: crypto.randomUUID(),
    leaseId: crypto.randomUUID(),
    attempts: 1,
    threadId: f.attempt.threadId,
    sentMessageId: f.sent.id,
    sentAt: new Date(Number(f.sent.internalDate)).toISOString(),
    intent: f.attempt.intent,
    envelopeHash: f.attempt.envelopeHash,
    draftInternetMessageId: f.attempt.draftInternetMessageId,
  };
  const store = {
    claim: vi.fn(async () => [task]),
    loadOriginal: vi.fn(async (): Promise<string | null> => f.body),
    finish: vi.fn(async () => true),
  };
  const gmailFor = vi.fn(async () => f.gmail),
    report = vi.fn();
  return { ...f, task, store, gmailFor, report };
}
describe('MAIL-058 comparación de respuestas enviadas', () => {
  it('compara una asociación confirmada y no almacena textos en los eventos', async () => {
    const f = fixture();
    await runReplyComparisons(f, 20);
    expect(f.store.finish).toHaveBeenCalledWith(
      f.task,
      expect.objectContaining({
        status: 'COMPLETED',
        metrics: expect.objectContaining({
          classification: 'UNCHANGED',
          similarity: 1,
        }),
      }),
    );
    expect(JSON.stringify(f.store.finish.mock.calls)).not.toContain(f.body);
    expect(JSON.stringify(f.report.mock.calls)).not.toContain(f.body);
  });
  it('elimina del texto final el historial citado de la conversación', async () => {
    const f = fixture();
    f.state.sent[0] = {
      ...f.sent,
      payload: {
        ...f.sent.payload,
        body: {
          data: Buffer.from(
            f.body +
              '\n\nOn Fri, Oct 30, Someone wrote:\n> Mensaje original privado.',
          ).toString('base64url'),
        },
      },
    };
    const result = await compareSentReply(f.gmail, f.task, f.body);
    expect(result).toMatchObject({
      status: 'COMPLETED',
      metrics: { classification: 'UNCHANGED', similarity: 1 },
    });
  });
  it('compara la fecha interna como instante aunque Postgres la serialice con otro formato', async () => {
    const f = fixture();
    f.task.sentAt = f.task.sentAt.replace('Z', '+00:00');
    expect(await compareSentReply(f.gmail, f.task, f.body)).toMatchObject({
      status: 'COMPLETED',
      metrics: { similarity: 1 },
    });
  });
  it('no lee Gmail sin un original autorizado y vigente', async () => {
    const f = fixture();
    f.store.loadOriginal.mockResolvedValue(null);
    await runReplyComparisons(f, 20);
    expect(f.gmailFor).not.toHaveBeenCalled();
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledWith(f.task, {
      status: 'SKIPPED',
      reason: 'ORIGINAL_UNAVAILABLE',
    });
  });
  it.each(['id', 'thread', 'recipients', 'date', 'marker', 'labels'])(
    'revalida la asociación antes de comparar: %s',
    async (field) => {
      const f = fixture();
      let message = f.sent;
      if (field === 'id') message = { ...message, id: 'other' };
      if (field === 'thread') message = { ...message, threadId: 'other' };
      if (field === 'recipients')
        message = withSentHeader(message, 'To', 'other@example.invalid');
      if (field === 'date')
        message = { ...message, internalDate: String(Date.now()) };
      if (field === 'marker')
        message = withSentHeader(
          message,
          'X-Auto-Email-Attempt',
          crypto.randomUUID(),
        );
      if (field === 'labels') message = { ...message, labelIds: ['DRAFT'] };
      f.gmail.getMessage.mockResolvedValue(message);
      expect(await compareSentReply(f.gmail, f.task, f.body)).toEqual({
        status: 'SKIPPED',
        reason: 'IDENTITY_CHANGED',
      });
    },
  );
  it('se abstiene si el cuerpo está incompleto', async () => {
    const f = fixture();
    f.state.sent[0] = {
      ...f.sent,
      payload: { ...f.sent.payload, body: { size: 100 } },
    };
    expect(await compareSentReply(f.gmail, f.task, f.body)).toEqual({
      status: 'SKIPPED',
      reason: 'UNSUPPORTED_CONTENT',
    });
  });
  it('permite reintentar un fallo transitorio sin registrar el cuerpo del error', async () => {
    const f = fixture();
    f.gmail.getMessage.mockRejectedValue(
      new ProviderError('google', 'UNAVAILABLE'),
    );
    await runReplyComparisons(f, 20);
    expect(f.store.finish).toHaveBeenCalledWith(f.task, {
      status: 'RETRY',
      reason: 'SENT_UNAVAILABLE',
    });
  });
  it('respeta abortos y leases perdidos', async () => {
    const f = fixture();
    await runReplyComparisons(f, 20, AbortSignal.abort());
    expect(f.store.claim).not.toHaveBeenCalled();
    f.store.finish.mockResolvedValue(false);
    await runReplyComparisons(f, 20);
    expect(f.report).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REPLY_COMPARISON_FAILED',
        reasonCode: 'COMPARISON_LEASE_LOST',
      }),
    );
  });
});
