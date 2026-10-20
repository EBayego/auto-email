import { describe, expect, it, vi } from 'vitest';
import { writingProfileFixture } from '../../tests/fixtures/writing-profile';
import type { GmailMessage } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { draftFixture } from '../../tests/fixtures/drafts';
import { createEmailFixtures } from '../../tests/fixtures/emails';
import { createReplyDraftForThread } from './create-reply-draft';
import {
  sampleNow,
  sentEmail,
  sentMailbox,
  withHeaders,
} from '../../tests/fixtures/sent-emails';

describe('generación y creación de un único borrador de respuesta', () => {
  it('aplica preferencias del destinatario y cancela si se editan o eliminan antes de escribir', async () => {
    for (const removed of [false, true]) {
      const input = draftFixture();
      const resolvePreferences = vi
        .fn()
        .mockResolvedValueOnce({
          preferences: [{ key: 'greeting', value: 'short' }],
          revisions: ['00000000-0000-4000-8000-000000000027'],
        })
        .mockResolvedValueOnce(
          removed
            ? { preferences: [], revisions: [] }
            : {
                preferences: [{ key: 'greeting', value: 'none' }],
                revisions: ['00000000-0000-4000-8000-000000000028'],
              },
        );
      const result = await createReplyDraftForThread({
        ...input,
        selection: { ...input.selection, resolvePreferences },
      });
      expect(result.draft?.status).toBe('CANCELLED');
      expect(input.gmail.createDraft).not.toHaveBeenCalled();
      expect(resolvePreferences).toHaveBeenCalledWith(
        'contact@example.invalid',
      );
      const payload = JSON.parse(input.text.generate.mock.calls[0][0].input);
      expect(payload.stylePreferences).toEqual([
        { key: 'greeting', value: 'short' },
      ]);
      expect(JSON.stringify(payload)).not.toContain('000000000027');
    }
  });
  it('integra la recuperación histórica en el borrador sin guardar cuerpos ni referencias en el registro', async () => {
    const input = draftFixture();
    const mailbox = sentMailbox([
      withHeaders(sentEmail(0), { To: 'contact@example.invalid' }),
    ]);
    const readDraft = input.gmail.getMessage.getMockImplementation()!;
    input.gmail.getMessage.mockImplementation((id, options) =>
      id === 'sent0' ? mailbox.getMessage(id, options) : readDraft(id, options),
    );
    input.gmail.listMessages.mockResolvedValue({
      messages: [{ id: 'sent0', threadId: 'thread0' }],
    });
    const result = await createReplyDraftForThread({
      ...input,
      now: sampleNow,
    });
    expect(result).toMatchObject({
      generation: { examplesUsed: 1 },
      draft: { status: 'CREATED', verified: true },
    });
    expect(
      JSON.parse(input.text.generate.mock.calls[0][0].input).styleExamples,
    ).toHaveLength(1);
    expect(JSON.stringify(input.store.reserve.mock.calls)).not.toMatch(
      /he revisado la propuesta|sent0|thread0/,
    );
    expect(input.gmail.createDraft).toHaveBeenCalledOnce();
  });
  it('usa y registra el perfil contextual y lo revalida antes de escribir', async () => {
    const input = draftFixture();
    const revision = '00000000-0000-4000-8000-000000000025';
    const style = {
      revision,
      profile: { ...writingProfileFixture(), formality: 'high' as const },
      scopeKind: 'RECIPIENT' as const,
    };
    const resolver = vi.fn().mockResolvedValue(style);
    const result = await createReplyDraftForThread({
      ...input,
      selection: { ...input.selection, resolveStyle: resolver },
    });
    expect(result.draft?.status).toBe('CREATED');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(input.store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ styleRevision: revision }),
    );
    expect(
      JSON.parse(input.text.generate.mock.calls[0][0].input).conversation.style
        .formality,
    ).toBe('high');
    expect(result.selection).toMatchObject({
      styleRevision: revision,
      styleScope: 'RECIPIENT',
    });
  });
  it('cancela la escritura si el perfil cambia durante la generación', async () => {
    const input = draftFixture();
    const resolver = vi
      .fn()
      .mockResolvedValueOnce({
        revision: '00000000-0000-4000-8000-000000000025',
        profile: writingProfileFixture(),
      })
      .mockResolvedValueOnce({
        revision: '00000000-0000-4000-8000-000000000026',
        profile: writingProfileFixture(),
      });
    const result = await createReplyDraftForThread({
      ...input,
      selection: { ...input.selection, resolveStyle: resolver },
    });
    expect(result.draft?.status).toBe('CANCELLED');
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('acepta que Gmail reemplace el Message-ID propio conservando las cabeceras de respuesta', async () => {
    const input = draftFixture();
    const read = input.gmail.getMessage.getMockImplementation()!;
    input.gmail.getMessage.mockImplementation(async (...args) => {
      const saved = await read(...args);
      return {
        ...saved,
        raw: Buffer.from(
          Buffer.from(saved.raw!, 'base64url')
            .toString('utf8')
            .replace(
              /Message-ID: <[^>]+>/,
              'Message-ID: <gmail-replacement@mail.gmail.com>',
            ),
        ).toString('base64url'),
      };
    });
    expect((await createReplyDraftForThread(input)).draft).toMatchObject({
      status: 'CREATED',
      verified: true,
    });
    expect(input.gmail.createDraft).toHaveBeenCalledOnce();
  });
  it('genera, revalida, guarda los IDs y verifica el borrador sin contenido en el informe', async () => {
    const input = draftFixture();
    const result = await createReplyDraftForThread(input);
    expect(result.draft).toMatchObject({
      status: 'CREATED',
      draftId: 'r-draft-21',
      draftMessageId: 'draft-message-21',
      verified: true,
    });
    expect(input.gmail.createDraft).toHaveBeenCalledOnce();
    expect(input.gmail.getThread).toHaveBeenCalledTimes(2);
    expect(input.store.created).toHaveBeenCalledBefore(input.gmail.getMessage);
    expect(input.store.verified).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(
      /he recibido|podemos reunirnos|bodyText|Subject:|To:/,
    );
    expect(input.rows[0]).toMatchObject({
      status: 'CREATED',
      draftId: 'r-draft-21',
      verified: true,
    });
  });
  it('omite un borrador manual inicial sin llamar a OpenAI ni alterar Gmail', async () => {
    const input = draftFixture();
    const thread = createEmailFixtures().manualDraft;
    input.selection.threadId = thread.id;
    input.gmail.getThread.mockResolvedValue(thread);
    const result = await createReplyDraftForThread(input);
    expect(result.selection.status).toBe('EXISTING_DRAFT');
    expect(result.draft).toBeNull();
    expect(input.text.generate).not.toHaveBeenCalled();
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
  });
  it.each([
    'manual-draft',
    'sent-reply',
    'new-incoming',
    'body',
    'subject',
    'recipient',
    'history',
  ])('cancela si cambia el hilo durante la generación: %s', async (change) => {
    const input = draftFixture();
    const changed = structuredClone(input.thread);
    const target = changed.messages[0];
    const added = structuredClone(target) as {
      -readonly [K in keyof GmailMessage]: GmailMessage[K];
    };
    added.id = 'new-message';
    added.internalDate = '1792239900000';
    if (change === 'manual-draft' || change === 'sent-reply') {
      added.labelIds = [change === 'manual-draft' ? 'DRAFT' : 'SENT'];
      added.payload = {
        ...target.payload,
        headers: [
          { name: 'From', value: 'owner@example.invalid' },
          { name: 'To', value: 'contact@example.invalid' },
          { name: 'Message-ID', value: '<new-message@example.invalid>' },
          { name: 'In-Reply-To', value: '<b100000000000001@example.invalid>' },
        ],
      };
      (changed.messages as GmailMessage[]).push(added);
    }
    if (change === 'new-incoming')
      (changed.messages as GmailMessage[]).push(added);
    if (change === 'body')
      (target.payload!.body as { data: string }).data = Buffer.from(
        'Otra petición diferente.',
      ).toString('base64url');
    if (change === 'subject' || change === 'recipient') {
      const header = target.payload!.headers!.find(
        (item) => item.name === (change === 'subject' ? 'Subject' : 'From'),
      )!;
      (header as { value: string }).value =
        change === 'subject' ? 'Asunto nuevo' : 'other@example.invalid';
    }
    if (change === 'history')
      (changed as { historyId: string }).historyId = 'new-history';
    input.gmail.getThread
      .mockResolvedValueOnce(input.thread)
      .mockResolvedValueOnce(changed);
    const result = await createReplyDraftForThread(input);
    expect(result.draft).toMatchObject({
      status: 'CANCELLED',
      reason: 'THREAD_CHANGED',
    });
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
    expect(input.rows[0].status).toBe('CANCELLED');
  });
  it('no escribe cuando el modelo devuelve falta de información', async () => {
    const input = draftFixture();
    input.text.generate.mockResolvedValue({
      text: JSON.stringify({
        status: 'INSUFFICIENT_CONTEXT',
        bodyText: null,
        language: 'es',
        missingInformation: ['Falta disponibilidad.'],
        evidence: [],
        warnings: ['MISSING_INFORMATION'],
      }),
      inputTokens: 20,
      outputTokens: 20,
    });
    const result = await createReplyDraftForThread(input);
    expect(result.generation?.status).toBe('INSUFFICIENT_CONTEXT');
    expect(result.draft).toBeNull();
    expect(input.store.reserve).not.toHaveBeenCalled();
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('un timeout posterior al POST queda bloqueado y no se vuelve a generar ni crear al repetir', async () => {
    const input = draftFixture();
    input.gmail.createDraft.mockRejectedValue(
      new ProviderError('google', 'UNAVAILABLE'),
    );
    const first = await createReplyDraftForThread(input);
    expect(first.draft).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      reason: 'GMAIL_WRITE_UNCERTAIN',
    });
    const second = await createReplyDraftForThread(input);
    expect(second.draft?.status).toBe('RECONCILIATION_REQUIRED');
    expect(second.generation).toBeNull();
    expect(input.gmail.createDraft).toHaveBeenCalledOnce();
    expect(input.text.generate).toHaveBeenCalledTimes(2);
    expect(input.rows[0].status).toBe('UNCERTAIN');
  });
  it('dos ejecuciones concurrentes reservan un solo intento de escritura', async () => {
    const input = draftFixture();
    const results = await Promise.all([
      createReplyDraftForThread(input),
      createReplyDraftForThread(input),
    ]);
    expect(input.gmail.createDraft).toHaveBeenCalledOnce();
    expect(input.rows).toHaveLength(1);
    expect(results.some((result) => result.draft?.status === 'CREATED')).toBe(
      true,
    );
  });
  it.each([
    {},
    { id: 'r-valid', message: { id: 'message', threadId: 'wrong-thread' } },
    { id: 'bad\r\n', message: {} },
  ])(
    'trata una respuesta de Google inválida como escritura incierta sin reintentar: %o',
    async (response) => {
      const input = draftFixture();
      input.gmail.createDraft.mockResolvedValue(response);
      const result = await createReplyDraftForThread(input);
      expect(result.draft?.status).toBe('RECONCILIATION_REQUIRED');
      expect(input.rows[0].status).toBe('UNCERTAIN');
      expect(input.gmail.createDraft).toHaveBeenCalledOnce();
      expect(input.gmail.getMessage).not.toHaveBeenCalled();
    },
  );
  it('no escribe si falla la reserva en base de datos', async () => {
    const input = draftFixture();
    input.store.reserve.mockRejectedValue(new Error('database failure'));
    await expect(createReplyDraftForThread(input)).rejects.toThrow(
      'database failure',
    );
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('conserva los IDs devueltos si falla su persistencia y bloquea otro POST', async () => {
    const input = draftFixture();
    input.store.created.mockRejectedValue(new Error('database failure'));
    const result = await createReplyDraftForThread(input);
    expect(result.draft).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      reason: 'PERSISTENCE_FAILED',
      draftId: 'r-draft-21',
      draftMessageId: 'draft-message-21',
    });
    expect(input.rows[0]).toMatchObject({
      status: 'UNCERTAIN',
      draftId: 'r-draft-21',
    });
    await createReplyDraftForThread(input);
    expect(input.gmail.createDraft).toHaveBeenCalledOnce();
  });
  it('un error en la lectura final mantiene el borrador registrado, sin crear otro', async () => {
    const input = draftFixture();
    input.gmail.getMessage.mockRejectedValue(new Error('read unavailable'));
    const result = await createReplyDraftForThread(input);
    expect(result.draft).toMatchObject({
      status: 'CREATED_UNVERIFIED',
      draftId: 'r-draft-21',
      verified: false,
    });
    expect(input.rows[0].status).toBe('CREATED');
    const repeated = await createReplyDraftForThread(input);
    expect(repeated.draft?.status).toBe('ALREADY_CREATED');
    expect(input.gmail.createDraft).toHaveBeenCalledOnce();
  });
  it('un error al revalidar se propaga antes del POST y cierra la reserva', async () => {
    const input = draftFixture();
    input.gmail.getThread
      .mockResolvedValueOnce(input.thread)
      .mockRejectedValueOnce(new ProviderError('google', 'PERMISSION_DENIED'));
    await expect(createReplyDraftForThread(input)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(input.rows[0].status).toBe('CANCELLED');
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
  });
  it('no confirma una lectura final que indica destinatario incorrecto, otro hilo o envío', async () => {
    for (const change of [
      { threadId: 'wrong' },
      { labelIds: ['SENT'] },
      { raw: undefined },
    ]) {
      const input = draftFixture();
      const original = input.gmail.getMessage.getMockImplementation()!;
      input.gmail.getMessage.mockImplementation(async (...args) => ({
        ...(await original(...args)),
        ...change,
      }));
      const result = await createReplyDraftForThread(input);
      expect(result.draft?.status).toBe('CREATED_UNVERIFIED');
      expect(input.store.verified).not.toHaveBeenCalled();
      expect(input.gmail.createDraft).toHaveBeenCalledOnce();
    }
  });
});
