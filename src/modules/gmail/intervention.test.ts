import { describe, expect, it, vi } from 'vitest';
import { createEmailFixtures } from '../../../tests/fixtures/emails';
import type { GmailThread } from '@/providers/contracts';
import { createGmailClient } from '@/providers/gmail';
import { ProviderError } from '@/providers/errors';
import { checkEmailIntervention, type KnownDraftAttempt } from './intervention';

function fixture(thread: GmailThread = createEmailFixtures().pending) {
  const gmail = { getThread: vi.fn(async () => thread), get: vi.fn() };
  const input = {
    gmail,
    accountId: 'account32',
    mailboxAddress: 'owner@example.invalid',
    threadId: thread.id,
    targetMessageId: thread.messages[0].id,
    attempts: [] as KnownDraftAttempt[],
  };
  const attempt: KnownDraftAttempt = {
    targetMessageId: input.targetMessageId,
    threadId: thread.id,
    status: 'CREATED',
    draftId: 'stable_draft',
    draftMessageId: 'old_message',
  };
  return { gmail, input, attempt };
}
describe('MAIL-032 intervención en una conversación', () => {
  it('continúa con una pregunta pendiente y no consulta borradores ajenos al hilo', async () => {
    const f = fixture();
    expect(await checkEmailIntervention(f.input)).toEqual({
      status: 'CONTINUE',
    });
    expect(f.gmail.getThread).toHaveBeenCalledExactlyOnceWith(
      f.input.threadId,
      { format: 'full' },
    );
    expect(f.gmail.get).not.toHaveBeenCalled();
  });
  it('omite una conversación con borrador manual aunque sus cabeceras afirmen ser del sistema', async () => {
    const thread = createEmailFixtures().manualDraft;
    thread.messages[1].payload.headers.push({
      name: 'X-Auto-Email-Job',
      value: 'trusted-looking-id',
    });
    const f = fixture(thread);
    expect(await checkEmailIntervention(f.input)).toEqual({
      status: 'SKIPPED',
      reasonCode: 'EXISTING_MANUAL_DRAFT',
    });
  });
  it('identifica un borrador editado mediante su ID estable, sin sobrescribirlo', async () => {
    const f = fixture(createEmailFixtures().manualDraft);
    f.input.attempts.push(f.attempt);
    f.gmail.get.mockResolvedValue({
      id: f.attempt.draftId,
      message: { id: 'b300000000000002', threadId: f.input.threadId },
    });
    expect(await checkEmailIntervention(f.input)).toEqual({
      status: 'SKIPPED',
      reasonCode: 'EXISTING_SYSTEM_DRAFT',
    });
    expect(f.gmail.get).toHaveBeenCalledExactlyOnceWith('drafts/stable_draft', {
      format: 'minimal',
    });
  });
  it('reconoce IDs de mensaje persistidos incluso si un intento incierto no guardó el ID estable', async () => {
    const f = fixture(createEmailFixtures().manualDraft);
    f.input.attempts.push({
      ...f.attempt,
      status: 'UNCERTAIN',
      draftId: null,
      draftMessageId: 'b300000000000002',
    });
    expect(await checkEmailIntervention(f.input)).toMatchObject({
      reasonCode: 'EXISTING_SYSTEM_DRAFT',
    });
    expect(f.gmail.get).not.toHaveBeenCalled();
  });
  it('protege el borrador manual cuando convive con uno gestionado', async () => {
    const thread = createEmailFixtures().manualDraft;
    thread.messages.push({ ...thread.messages[1], id: 'another_draft' });
    const f = fixture(thread);
    f.input.attempts.push({
      ...f.attempt,
      draftId: null,
      draftMessageId: 'b300000000000002',
    });
    expect(await checkEmailIntervention(f.input)).toMatchObject({
      reasonCode: 'EXISTING_MANUAL_DRAFT',
    });
  });
  it('no repite un objetivo con un borrador creado aunque ya no esté en Gmail', async () => {
    const f = fixture();
    f.input.attempts.push(f.attempt);
    expect(await checkEmailIntervention(f.input)).toEqual({
      status: 'SKIPPED',
      reasonCode: 'TARGET_ALREADY_PROCESSED',
    });
    expect(f.gmail.get).not.toHaveBeenCalled();
  });
  it.each(['CREATING', 'UNCERTAIN'] as const)(
    'lleva a revisión un intento %s sin confirmar, también de otro objetivo del mismo hilo',
    async (status) => {
      const f = fixture();
      f.input.attempts.push({
        ...f.attempt,
        targetMessageId: 'earlier',
        status,
        draftId: null,
        draftMessageId: null,
      });
      expect(await checkEmailIntervention(f.input)).toEqual({
        status: 'REVIEW_REQUIRED',
        reasonCode: 'DRAFT_RECONCILIATION_REQUIRED',
      });
    },
  );
  it('conserva para revisión una reserva cancelada del mismo objetivo', async () => {
    const f = fixture();
    f.input.attempts.push({
      ...f.attempt,
      status: 'CANCELLED',
      draftId: null,
      draftMessageId: null,
    });
    expect(await checkEmailIntervention(f.input)).toMatchObject({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'DRAFT_ATTEMPT_CANCELLED',
    });
  });
  it('omite una respuesta ya enviada, aunque la API devuelva los mensajes desordenados', async () => {
    const thread = createEmailFixtures().answered;
    const f = fixture(thread);
    thread.messages.reverse();
    expect(await checkEmailIntervention(f.input)).toEqual({
      status: 'SKIPPED',
      reasonCode: 'ALREADY_ANSWERED',
    });
  });
  it('lleva a revisión una posible respuesta sin cabeceras que la vinculen al objetivo', async () => {
    const thread = createEmailFixtures().answered;
    thread.messages[1].payload.headers =
      thread.messages[1].payload.headers.filter(
        (header) => !['In-Reply-To', 'References'].includes(header.name),
      );
    expect(await checkEmailIntervention(fixture(thread).input)).toEqual({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'POSSIBLE_EXISTING_REPLY',
    });
  });
  it('no toma una respuesta antigua como respuesta a una nueva pregunta', async () => {
    const thread = createEmailFixtures().answered;
    const first = thread.messages[0];
    thread.messages.push({
      ...first,
      id: 'new_question',
      internalDate: String(Number(thread.messages[1].internalDate) + 60000),
      payload: {
        ...first.payload,
        headers: first.payload.headers.map((header) =>
          header.name === 'Message-ID'
            ? { ...header, value: '<new-question@example.invalid>' }
            : header,
        ),
      },
    });
    const f = fixture(thread);
    f.input.targetMessageId = 'new_question';
    expect(await checkEmailIntervention(f.input)).toEqual({
      status: 'CONTINUE',
    });
  });
  it('omite el objetivo sustituido por un correo posterior', async () => {
    const thread = createEmailFixtures().pending;
    const first = thread.messages[0];
    thread.messages.push({
      ...first,
      id: 'new_question',
      internalDate: String(Number(first.internalDate) + 60000),
      payload: {
        ...first.payload,
        headers: first.payload.headers.map((header) =>
          header.name === 'Message-ID'
            ? { ...header, value: '<new-question@example.invalid>' }
            : header,
        ),
      },
    });
    expect(await checkEmailIntervention(fixture(thread).input)).toMatchObject({
      status: 'SKIPPED',
      reasonCode: 'TARGET_SUPERSEDED',
    });
  });
  it('no considera un From falsificado como una respuesta del propietario sin etiqueta SENT', async () => {
    const thread = createEmailFixtures().answered;
    thread.messages[1].labelIds = ['INBOX'];
    expect(await checkEmailIntervention(fixture(thread).input)).toEqual({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'THREAD_UNVERIFIABLE',
    });
  });
  it('no utiliza un borrador borrado como evidencia para identificar otro manual', async () => {
    const f = fixture(createEmailFixtures().manualDraft);
    f.input.attempts.push(f.attempt);
    f.gmail.get.mockRejectedValue(new ProviderError('google', 'NOT_FOUND'));
    expect(await checkEmailIntervention(f.input)).toMatchObject({
      reasonCode: 'EXISTING_MANUAL_DRAFT',
    });
  });
  it('un fallo de Gmail no autoriza continuar y no expone contenido', async () => {
    const f = fixture(createEmailFixtures().manualDraft);
    f.input.attempts.push(f.attempt);
    f.gmail.get.mockRejectedValue(new ProviderError('google', 'RATE_LIMITED'));
    await expect(checkEmailIntervention(f.input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    f.gmail.get.mockResolvedValue({
      id: 'wrong',
      message: { id: 'message', threadId: 'other' },
    });
    await expect(checkEmailIntervention(f.input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('rechaza un historial cruzado antes de consultar Gmail', async () => {
    const f = fixture();
    f.input.attempts.push({ ...f.attempt, threadId: 'other' });
    await expect(checkEmailIntervention(f.input)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(f.gmail.getThread).not.toHaveBeenCalled();
  });
  it('no continúa si falta el objetivo o el hilo está incompleto', async () => {
    const f = fixture();
    f.input.targetMessageId = 'missing';
    expect(await checkEmailIntervention(f.input)).toEqual({
      status: 'REVIEW_REQUIRED',
      reasonCode: 'THREAD_UNVERIFIABLE',
    });
  });
  it('solo permite leer un borrador concreto por el transporte autorizado', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 'stable_draft',
        message: { id: 'edited_message', threadId: 'thread32' },
      }),
    );
    const client = createGmailClient(
      async () => 'synthetic-access-token',
      1000,
      fetcher,
    );
    await client.get('drafts/stable_draft', { format: 'minimal' });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts/stable_draft?format=minimal',
    );
    await expect(client.get('drafts/../messages/send')).rejects.toMatchObject({
      code: 'REQUEST_REJECTED',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
