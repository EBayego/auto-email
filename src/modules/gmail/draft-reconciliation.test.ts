import { describe, expect, it, vi } from 'vitest';
import type { GmailClient } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { buildReplyMime } from './reply-mime';
import { draftFingerprint } from './draft-intent';
import {
  reconcileGmailDraft,
  type ReconciliationAttempt,
} from './draft-reconciliation';
import { runDraftReconciliation } from '@/worker/draft-reconciliation';

function fixture() {
  const id = '00000000-0000-4000-8000-000000000048';
  const target = {
    to: { name: '', address: 'contact@example.invalid' },
    subject: 'Consulta',
    inReplyTo: '<incoming@example.invalid>',
    references: ['<incoming@example.invalid>'],
  };
  const bodyText =
    'Hola,\n\nConfirmo que he recibido tu mensaje.\n\nUn saludo.';
  const mime = buildReplyMime({
    from: 'owner@example.invalid',
    target,
    bodyText,
    attemptId: id,
  });
  const attempt: ReconciliationAttempt = {
    id,
    userId: '10000000-0000-4000-8000-000000000048',
    gmailAccountId: '20000000-0000-4000-8000-000000000048',
    threadId: 'thread48',
    targetMessageId: 'incoming48',
    draftId: null,
    writeStartedAt: '2026-10-24T00:00:00Z',
    leaseId: '30000000-0000-4000-8000-000000000048',
    intent: {
      version: 'mail048-v1',
      internetMessageId: mime.internetMessageId,
      inReplyTo: target.inReplyTo,
      fingerprint: draftFingerprint({
        from: [{ name: '', address: 'owner@example.invalid' }],
        to: mime.to,
        cc: mime.cc,
        subject: mime.subject,
        inReplyTo: [target.inReplyTo],
        bodyText,
      }),
    },
  };
  const draft = {
    id: 'draft48',
    message: {
      id: 'message48',
      threadId: 'thread48',
      labelIds: ['DRAFT'],
      raw: mime.raw,
    },
  };
  const get = vi
    .fn<GmailClient['get']>()
    .mockImplementation(async (resource) =>
      resource === 'drafts'
        ? {
            drafts: [
              {
                id: draft.id,
                message: {
                  id: draft.message.id,
                  threadId: draft.message.threadId,
                },
              },
            ],
          }
        : draft,
    );
  return { attempt, draft, get, mime };
}
describe('MAIL-048 reconciliación sin escrituras Gmail', () => {
  it('encuentra un POST cuyo resultado se perdió y devuelve sus IDs estables', async () => {
    const f = fixture();
    expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
      result: 'FOUND',
      draftId: 'draft48',
      messageId: 'message48',
    });
    expect(f.get.mock.calls.map(([resource]) => resource)).toEqual([
      'drafts',
      'drafts/draft48',
    ]);
  });
  it('un ID estable permite reconocer un borrador editado sin sobrescribirlo', async () => {
    const f = fixture();
    f.attempt.draftId = f.draft.id;
    f.draft.message.id = 'edited48';
    f.draft.message.raw = buildReplyMime({
      from: 'owner@example.invalid',
      target: {
        to: { name: '', address: 'different@example.invalid' },
        subject: 'Editado',
        inReplyTo: '<incoming@example.invalid>',
        references: [],
      },
      bodyText: 'Texto editado por el usuario.',
      attemptId: crypto.randomUUID(),
    }).raw;
    const before = f.draft.message.raw;
    expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
      result: 'EDITED',
      draftId: 'draft48',
      messageId: 'edited48',
    });
    expect(f.draft.message.raw).toBe(before);
    expect(f.get).toHaveBeenCalledOnce();
  });
  it.each(['body', 'marker', 'reply', 'thread', 'sent'] as const)(
    'no atribuye un borrador desconocido por una coincidencia parcial: %s',
    async (change) => {
      const f = fixture();
      let raw = Buffer.from(f.draft.message.raw, 'base64url').toString();
      if (change === 'body')
        raw = raw
          .replace(
            'Content-Transfer-Encoding: base64',
            'Content-Transfer-Encoding: 8bit',
          )
          .replace(/\r\n\r\n[\s\S]*/u, '\r\n\r\nTexto diferente.');
      if (change === 'marker')
        raw = raw.replaceAll(
          f.attempt.id,
          '99999999-0000-4000-8000-000000000048',
        );
      if (change === 'reply')
        raw = raw.replace(
          '<incoming@example.invalid>',
          '<other@example.invalid>',
        );
      if (change === 'thread') f.draft.message.threadId = 'other48';
      if (change === 'sent') f.draft.message.labelIds = ['SENT'];
      f.draft.message.raw = Buffer.from(raw).toString('base64url');
      expect(
        (await reconcileGmailDraft({ get: f.get }, f.attempt)).result,
      ).toBe('MISSING');
    },
  );
  it('exige todas las páginas antes de resolver y detecta varios candidatos', async () => {
    const f = fixture();
    f.get.mockImplementation(async (resource) =>
      resource === 'drafts'
        ? {
            drafts: [
              {
                id: 'draft48',
                message: { id: 'message48', threadId: 'thread48' },
              },
              {
                id: 'second48',
                message: { id: 'second-message48', threadId: 'thread48' },
              },
            ],
          }
        : resource === 'drafts/draft48'
          ? f.draft
          : {
              ...f.draft,
              id: 'second48',
              message: { ...f.draft.message, id: 'second-message48' },
            },
    );
    expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
      result: 'AMBIGUOUS',
    });
  });
  it('continúa paginando si el borrador aparece en una página posterior', async () => {
    const f = fixture();
    f.get
      .mockReset()
      .mockResolvedValueOnce({ drafts: [], nextPageToken: 'page2' })
      .mockResolvedValueOnce({
        drafts: [
          { id: 'draft48', message: { id: 'message48', threadId: 'thread48' } },
        ],
      })
      .mockResolvedValueOnce(f.draft);
    expect((await reconcileGmailDraft({ get: f.get }, f.attempt)).result).toBe(
      'FOUND',
    );
    expect(f.get.mock.calls[1]).toEqual([
      'drafts',
      { maxResults: 100, pageToken: 'page2' },
    ]);
  });
  it('una exploración incompleta no convierte ausencia en autorización para reintentar', async () => {
    const f = fixture();
    let n = 0;
    f.get.mockImplementation(async () => ({
      drafts: [],
      nextPageToken: `page${++n}`,
    }));
    expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
      result: 'UNCONFIRMED',
    });
    expect(f.get).toHaveBeenCalledTimes(5);
  });
  it.each(['loop', 'duplicate', 'malformed', 'network'] as const)(
    'falla de forma cerrada ante %s',
    async (change) => {
      const f = fixture();
      if (change === 'loop')
        f.get.mockResolvedValue({ drafts: [], nextPageToken: 'same' });
      if (change === 'duplicate')
        f.get.mockResolvedValue({
          drafts: Array(2).fill({
            id: 'draft48',
            message: { id: 'message48', threadId: 'other48' },
          }),
        });
      if (change === 'malformed')
        f.get.mockResolvedValue({
          drafts: [{ id: 'bad', message: { id: 'bad' } }],
        });
      if (change === 'network')
        f.get.mockRejectedValue(new Error('body secret'));
      expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
        result: 'UNAVAILABLE',
      });
    },
  );
  it('conserva un ID conocido aunque Gmail indique que fue borrado o enviado', async () => {
    const f = fixture();
    f.attempt.draftId = 'draft48';
    f.get.mockRejectedValue(new ProviderError('google', 'NOT_FOUND'));
    expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
      result: 'MISSING',
    });
    expect(f.attempt.draftId).toBe('draft48');
  });
  it('no consulta Gmail si el intento no llegó al permiso de escritura', async () => {
    const f = fixture();
    f.attempt.writeStartedAt = null;
    expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
      result: 'NOT_STARTED',
    });
    expect(f.get).not.toHaveBeenCalled();
  });
  it('no adivina correspondencia en intentos antiguos sin huella', async () => {
    const f = fixture();
    f.attempt.intent = null;
    expect(await reconcileGmailDraft({ get: f.get }, f.attempt)).toEqual({
      result: 'UNCONFIRMED',
    });
    expect(f.get).not.toHaveBeenCalled();
  });
  it('registra únicamente IDs y resultados, preservando la recuperación si Supabase falla', async () => {
    const f = fixture(),
      report = vi.fn(),
      finish = vi.fn().mockRejectedValue(new Error('storage secret'));
    await runDraftReconciliation(
      {
        store: { claim: vi.fn().mockResolvedValue([f.attempt]), finish },
        gmailFor: vi.fn().mockResolvedValue({ get: f.get }),
        report,
      },
      1,
    );
    expect(finish).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith({
      type: 'DRAFT_RECONCILIATION_FAILED',
      accountId: f.attempt.gmailAccountId,
      attemptId: f.attempt.id,
      reasonCode: 'RECONCILIATION_UNAVAILABLE',
    });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/secret|Confirmo/);
  });
});
