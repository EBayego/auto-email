import { describe, expect, it, vi } from 'vitest';
import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { prepareSentSample } from '@/modules/identity/sent-sample';
import {
  sampleOwner,
  sampleNow,
  sentEmail,
  sentMailbox,
  withHeaders,
} from '../../tests/fixtures/sent-emails';
import { createEmailFixtures } from '../../tests/fixtures/emails';
import {
  readyResponse,
  supportedResponse,
} from '../../tests/fixtures/responses';
import {
  writingProfileFixture,
  writingProfileRow,
} from '../../tests/fixtures/writing-profile';
import { generateReplyForThread } from './generate-reply';
function fixture(
  name: keyof ReturnType<typeof createEmailFixtures> = 'pending',
) {
  const thread = createEmailFixtures()[name];
  return {
    gmail: {
      listMessages: vi
        .fn<GmailClient['listMessages']>()
        .mockResolvedValue({ messages: [] }),
      getThread: vi.fn<GmailClient['getThread']>().mockResolvedValue(thread),
      getMessage: vi.fn<GmailClient['getMessage']>(),
      createDraft: vi.fn(),
    },
    text: {
      generate: vi
        .fn<TextGenerationClient['generate']>()
        .mockResolvedValueOnce({
          text: JSON.stringify(readyResponse()),
          inputTokens: 100,
          outputTokens: 80,
        })
        .mockResolvedValueOnce({
          text: JSON.stringify(supportedResponse()),
          inputTokens: 50,
          outputTokens: 20,
        }),
    },
    selection: {
      accountId: 'account-20',
      mailboxAddress: 'owner@example.invalid',
      threadId: thread.id,
      style: {
        revision: writingProfileRow().revision,
        profile: writingProfileFixture(),
      },
    },
  };
}
describe('selección y generación sin escrituras en Gmail', () => {
  it('envía al generador ejemplos recuperados bajo demanda usando solo el perfil general y sin muestra guardada', async () => {
    const input = fixture();
    const mailbox = sentMailbox([
      withHeaders(sentEmail(0), { To: 'contact@example.invalid' }),
    ]);
    input.gmail.listMessages.mockResolvedValue({
      messages: [{ id: 'sent0', threadId: 'thread0' }],
    });
    const report = await generateReplyForThread({
      ...input,
      gmail: { ...input.gmail, getMessage: mailbox.getMessage },
      now: sampleNow,
    });
    expect(report.generation).toMatchObject({
      examplesUsed: 1,
      styleExamplesUnavailable: false,
    });
    const payload = JSON.parse(input.text.generate.mock.calls[0][0].input);
    expect(payload.styleExamples).toEqual([
      { text: expect.stringContaining('he revisado la propuesta') },
    ]);
    expect(Object.keys(payload.styleExamples[0])).toEqual(['text']);
    expect(JSON.stringify(payload)).not.toMatch(
      /sent0|thread0|contact@example/,
    );
    expect(input.text.generate.mock.calls[1][0].input).not.toContain(
      'he revisado la propuesta',
    );
  });
  it('detiene la generación si recuperar el historial revela un problema de permisos', async () => {
    const input = fixture();
    input.gmail.listMessages.mockRejectedValue(
      new ProviderError('google', 'PERMISSION_DENIED'),
    );
    await expect(generateReplyForThread(input)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(input.text.generate).not.toHaveBeenCalled();
  });
  it('descarta los ejemplos al fallar OpenAI y permite deshabilitar la recuperación', async () => {
    const input = fixture();
    const examples = [
      {
        text: 'Hola, gracias por compartir el documento y comentar los siguientes pasos.',
      },
    ];
    const retrieve = vi.fn().mockResolvedValue(examples);
    input.text.generate
      .mockReset()
      .mockRejectedValue(new ProviderError('openai', 'UNAVAILABLE'));
    await expect(
      generateReplyForThread({ ...input, styleExampleRetriever: { retrieve } }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(examples).toEqual([]);
    retrieve.mockClear();
    await expect(
      generateReplyForThread({
        ...input,
        styleExampleRetriever: { retrieve },
        styleExamplesLimit: 0,
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(retrieve).not.toHaveBeenCalled();
    expect(input.gmail.listMessages).not.toHaveBeenCalled();
  });
  it('recupera ejemplos para el destinatario real y prioriza referencias del perfil sin enviar IDs al modelo', async () => {
    const input = fixture();
    const mailbox = sentMailbox([
      sentEmail(0),
      withHeaders(sentEmail(1), { To: 'contact@example.invalid' }),
    ]);
    const sample = await prepareSentSample(
      mailbox,
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    const resolver = vi.fn().mockResolvedValue({
      ...input.selection.style,
      scopeKind: 'RECIPIENT',
      exampleMessageIds: ['sent1', 'not-in-manifest'],
    });
    const report = await generateReplyForThread({
      ...input,
      gmail: { ...input.gmail, getMessage: mailbox.getMessage },
      selection: { ...input.selection, resolveStyle: resolver },
      sample,
      now: sampleNow,
    });
    expect(report.generation?.examplesUsed).toBe(1);
    expect(input.gmail.listMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        mailbox: 'sent',
        to: 'contact@example.invalid',
      }),
    );
    expect(
      mailbox.getMessage.mock.calls.some(([id]) => id === 'not-in-manifest'),
    ).toBe(false);
    expect(input.text.generate.mock.calls[0][0].input).not.toMatch(
      /sent1|not-in-manifest/,
    );
  });
  it('entrega la propuesta validada en memoria, separada del informe sin contenido', async () => {
    const input = fixture();
    const consume = vi.fn(async (response, context) => {
      expect(response.bodyText).toBe(readyResponse().bodyText);
      expect(context.replyTarget.to.address).toBe('contact@example.invalid');
      expect(context.modelInput.messages).toHaveLength(1);
    });
    const result = await generateReplyForThread({ ...input, consume });
    expect(result).toMatchObject({
      selection: { status: 'SELECTED' },
      generation: {
        status: 'READY',
        modelCalls: 2,
        examplesUsed: 0,
        styleExamplesUnavailable: true,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /he recibido|podemos reunirnos|bodyText/,
    );
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
    expect(input.gmail.getMessage).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledOnce();
  });
  it.each(['answered', 'manualDraft', 'notification'] as const)(
    'no llama a OpenAI ni lee ejemplos para %s',
    async (name) => {
      const input = fixture(name);
      const result = await generateReplyForThread(input);
      expect(result.generation).toBeNull();
      expect(input.text.generate).not.toHaveBeenCalled();
      expect(input.gmail.getMessage).not.toHaveBeenCalled();
      expect(input.gmail.createDraft).not.toHaveBeenCalled();
    },
  );
  it('requiere un perfil confirmado suministrado por el acceso autorizado y valida los límites antes de Gmail', async () => {
    const input = fixture();
    await expect(
      generateReplyForThread({
        ...input,
        selection: { ...input.selection, style: undefined },
      }),
    ).rejects.toMatchObject({ code: 'STYLE_PROFILE_REQUIRED' });
    await expect(
      generateReplyForThread({ ...input, styleExamplesLimit: 4 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(input.gmail.getThread).not.toHaveBeenCalled();
    expect(input.text.generate).not.toHaveBeenCalled();
  });
  it('propaga errores de OpenAI sin entregar una propuesta parcial al consumidor', async () => {
    const input = fixture();
    input.text.generate
      .mockReset()
      .mockRejectedValue(new ProviderError('openai', 'RATE_LIMITED'));
    const consume = vi.fn();
    await expect(
      generateReplyForThread({ ...input, consume }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(consume).not.toHaveBeenCalled();
    expect(input.gmail.createDraft).not.toHaveBeenCalled();
  });
});
