import { describe, expect, it, vi } from 'vitest';
import { trackSentGmailDraft } from './sent-draft-tracking';
import { ProviderError } from '@/providers/errors';
import {
  sentDraftFixture,
  withSentHeader,
} from '../../../tests/fixtures/sent-drafts';
import { runSentDraftTracking } from '@/worker/sent-draft-tracking';
describe('MAIL-057 detección de envíos con evidencia', () => {
  it('asocia el nuevo ID SENT aunque cambie el texto, sin recuperar cuerpos', async () => {
    const f = sentDraftFixture();
    f.state.sent[0] = {
      ...f.sent,
      payload: {
        ...f.sent.payload,
        body: {
          data: Buffer.from('Texto editado por el titular.').toString(
            'base64url',
          ),
        },
      },
    };
    expect(
      (await trackSentGmailDraft(f.gmail, f.attempt)).outcome,
    ).toMatchObject({
      status: 'SENT',
      reason: 'MATCHED_MARKER',
      messageId: 'sent57',
    });
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
    expect(f.gmail.getThread).toHaveBeenCalledWith(
      'thread57',
      expect.objectContaining({ format: 'metadata' }),
    );
  });
  it('reconoce el Message-ID observado en Gmail cuando se pierde la cabecera propia', async () => {
    const f = sentDraftFixture();
    f.state.sent[0] = withSentHeader(f.sent, 'X-Auto-Email-Attempt', null);
    expect(
      (await trackSentGmailDraft(f.gmail, f.attempt)).outcome,
    ).toMatchObject({ status: 'SENT', reason: 'MATCHED_MESSAGE_ID' });
  });
  it('no infiere envío ni descarte si únicamente desaparece el borrador', async () => {
    const f = sentDraftFixture();
    f.state.sent = [];
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome).toEqual({
      status: 'INDETERMINATE',
      reason: 'MISSING_DRAFT',
    });
  });
  it('mantiene pendiente el borrador que continúa en Gmail', async () => {
    const f = sentDraftFixture();
    f.state.sent = [];
    f.state.draftPresent = true;
    expect(await trackSentGmailDraft(f.gmail, f.attempt)).toMatchObject({
      outcome: { status: 'PENDING', reason: 'DRAFT_PRESENT' },
      observedDraftInternetMessageId: '<gmail-draft57@example.invalid>',
    });
  });
  it.each(['to', 'cc', 'bcc', 'from', 'in-reply-to'])(
    'no asocia una identidad o destinatarios distintos: %s',
    async (header) => {
      const f = sentDraftFixture();
      f.state.sent[0] = withSentHeader(
        f.sent,
        header,
        header === 'in-reply-to'
          ? '<another@example.invalid>'
          : 'other@example.invalid',
      );
      expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome).toEqual({
        status: 'INDETERMINATE',
        reason: 'IDENTITY_MISMATCH',
      });
    },
  );
  it.each(['past', 'future', 'missing'])(
    'verifica la fecha interna del mensaje: %s',
    async (kind) => {
      const f = sentDraftFixture();
      f.state.sent[0] = {
        ...f.sent,
        internalDate:
          kind === 'missing'
            ? undefined
            : String(kind === 'past' ? f.writeAt - 60000 : Date.now() + 600000),
      };
      expect(
        (await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status,
      ).toBe('INDETERMINATE');
    },
  );
  it('no confía en un Date MIME reciente cuando internalDate es anterior a generar', async () => {
    const f = sentDraftFixture();
    f.state.sent[0] = {
      ...withSentHeader(f.sent, 'Date', new Date().toUTCString()),
      internalDate: String(f.writeAt - 60000),
    };
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'INDETERMINATE',
    );
  });
  it('un texto idéntico sin correlación sigue siendo indeterminado', async () => {
    const f = sentDraftFixture();
    f.state.sent[0] = withSentHeader(
      withSentHeader(f.sent, 'X-Auto-Email-Attempt', null),
      'Message-ID',
      '<manual@example.invalid>',
    );
    expect(
      (await trackSentGmailDraft(f.gmail, f.attempt)).outcome,
    ).toMatchObject({ status: 'INDETERMINATE', reason: 'UNCORRELATED_REPLY' });
  });
  it('distingue una respuesta manual si el borrador original sigue existiendo después de leer SENT', async () => {
    const f = sentDraftFixture();
    f.state.draftPresent = true;
    f.state.sent[0] = withSentHeader(
      withSentHeader(f.sent, 'X-Auto-Email-Attempt', null),
      'Message-ID',
      '<manual@example.invalid>',
    );
    expect(
      (await trackSentGmailDraft(f.gmail, f.attempt)).outcome,
    ).toMatchObject({ status: 'MANUAL_REPLY', reason: 'SEPARATE_REPLY' });
    expect(f.gmail.get).toHaveBeenCalledTimes(2);
  });
  it('no afirma respuesta manual si desaparece el borrador durante la comprobación', async () => {
    const f = sentDraftFixture();
    f.gmail.get.mockResolvedValueOnce(f.state.draft);
    f.state.sent[0] = withSentHeader(
      withSentHeader(f.sent, 'X-Auto-Email-Attempt', null),
      'Message-ID',
      '<manual@example.invalid>',
    );
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'INDETERMINATE',
    );
  });
  it('no da por enviado un borrador que aún existe después de leer la respuesta correlacionada', async () => {
    const f = sentDraftFixture();
    f.state.draftPresent = true;
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome).toEqual({
      status: 'INDETERMINATE',
      reason: 'DRAFT_STILL_PRESENT',
    });
  });
  it('tolera que se envíe entre la consulta de borrador y la del hilo', async () => {
    const f = sentDraftFixture();
    f.gmail.get.mockResolvedValueOnce(f.state.draft);
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'SENT',
    );
  });
  it('asocia un envío tras una escritura incierta aunque no se haya guardado draftId', async () => {
    const f = sentDraftFixture();
    f.attempt.draftId = null;
    f.attempt.status = 'UNCERTAIN';
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'SENT',
    );
    expect(f.gmail.get).not.toHaveBeenCalled();
  });
  it('permite generaciones antiguas solo con identidad fuerte y fingerprint íntegro', async () => {
    const f = sentDraftFixture();
    f.attempt.envelopeHash = null;
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'SENT',
    );
    expect(f.gmail.getMessage).toHaveBeenCalledWith('sent57', {
      format: 'full',
    });
    f.state.sent[0] = {
      ...f.sent,
      payload: {
        ...f.sent.payload,
        body: { data: Buffer.from('Texto cambiado.').toString('base64url') },
      },
    };
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'INDETERMINATE',
    );
  });
  it('no decide entre varios mensajes con la misma correlación', async () => {
    const f = sentDraftFixture();
    f.state.sent.push({ ...f.sent, id: 'sent57copy' });
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome).toEqual({
      status: 'INDETERMINATE',
      reason: 'AMBIGUOUS',
    });
  });
  it('rechaza cabeceras de correlación duplicadas o incompatibles', async () => {
    const f = sentDraftFixture();
    f.state.sent[0] = {
      ...f.sent,
      payload: {
        ...f.sent.payload,
        headers: [
          ...f.sent.payload!.headers!,
          { name: 'X-Auto-Email-Attempt', value: crypto.randomUUID() },
        ],
      },
    };
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'INDETERMINATE',
    );
  });
  it('valida el hilo y el mensaje entrante original', async () => {
    const f = sentDraftFixture();
    f.gmail.getThread.mockResolvedValue({
      id: 'another',
      messages: [f.incoming, f.sent],
    });
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'INDETERMINATE',
    );
    f.gmail.getThread.mockResolvedValue({ id: 'thread57', messages: [f.sent] });
    expect((await trackSentGmailDraft(f.gmail, f.attempt)).outcome.status).toBe(
      'INDETERMINATE',
    );
  });
  it('los errores de lectura nunca implican envío y no se guardan sus cuerpos', async () => {
    const f = sentDraftFixture();
    f.gmail.get.mockRejectedValue(new ProviderError('google', 'UNAVAILABLE'));
    expect(await trackSentGmailDraft(f.gmail, f.attempt)).toEqual({
      outcome: { status: 'INDETERMINATE', reason: 'UNAVAILABLE' },
    });
  });
  it('una cancelación anterior a escribir descarta la generación sin leer Gmail', async () => {
    const f = sentDraftFixture();
    f.attempt.status = 'CANCELLED';
    f.attempt.writeStartedAt = null;
    expect(await trackSentGmailDraft(f.gmail, f.attempt)).toEqual({
      outcome: { status: 'DISCARDED', reason: 'WRITE_CANCELLED' },
    });
    expect(f.gmail.getThread).not.toHaveBeenCalled();
  });
  it('el worker respeta abortos, leases perdidos y comunica solo metadatos', async () => {
    const f = sentDraftFixture(),
      report = vi.fn(),
      finish = vi.fn().mockResolvedValue(false),
      claim = vi.fn().mockResolvedValue([f.attempt]);
    const deps = {
      store: { claim, finish },
      gmailFor: async () => f.gmail,
      report,
    };
    await runSentDraftTracking(deps, 20, AbortSignal.abort());
    expect(claim).not.toHaveBeenCalled();
    await runSentDraftTracking(deps, 20);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SENT_DRAFT_CHECK_FAILED',
        reasonCode: 'TRACKING_LEASE_LOST',
      }),
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain(f.body);
  });
});
