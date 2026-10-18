import { describe, expect, it, vi } from 'vitest';
import type { GmailClient, TextGenerationClient } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
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
