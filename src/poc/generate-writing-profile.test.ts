import { describe, expect, it, vi } from 'vitest';
import type { TextGenerationClient } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import { prepareSentSample } from '@/modules/identity/sent-sample';
import {
  sampleNow,
  sampleOwner,
  sentEmail,
  sentMailbox,
} from '../../tests/fixtures/sent-emails';
import {
  writingProfileFixture,
  writingProfileRow,
} from '../../tests/fixtures/writing-profile';
import { generateWritingProfile } from './generate-writing-profile';
import type { createWritingProfileRepository } from '@/db/writing-profiles';
describe('MAIL-018, Gmail → OpenAI → perfil reutilizable', () => {
  async function fixture() {
    const emails = [sentEmail(0), sentEmail(1)];
    const manifest = await prepareSentSample(
      sentMailbox(emails),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    return {
      gmail: sentMailbox(emails),
      manifest,
      mailboxAddress: sampleOwner,
      model: 'test-model',
      now: sampleNow,
      text: {
        generate: vi.fn<TextGenerationClient['generate']>().mockResolvedValue({
          text: JSON.stringify(writingProfileFixture()),
          inputTokens: 100,
          outputTokens: 80,
        }),
      },
      repository: {
        save: vi
          .fn<ReturnType<typeof createWritingProfileRepository>['save']>()
          .mockResolvedValue(writingProfileRow()),
      },
    };
  }
  it('genera con los IDs guardados, no escanea el buzón y persiste solo el perfil y métricas', async () => {
    const f = await fixture();
    expect((await generateWritingProfile(f)).profile).toEqual(
      writingProfileFixture(),
    );
    expect(f.gmail.listMessages).not.toHaveBeenCalled();
    expect(f.text.generate).toHaveBeenCalledOnce();
    expect(f.repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleSize: 2,
        sourceMessageIds: ['sent0', 'sent1'],
        inputTokens: 100,
        outputTokens: 80,
        warnings: ['BELOW_RECOMMENDED_SIZE'],
      }),
    );
    expect(JSON.stringify(f.repository.save.mock.calls)).not.toContain(
      'authoredText',
    );
  });
  it('señala cambios de la muestra y nunca envía mensajes descartados al modelo', async () => {
    const f = await fixture();
    f.gmail = sentMailbox([
      sentEmail(0),
      sentEmail(1, { labelIds: ['SENT', 'TRASH'] }),
    ]);
    await generateWritingProfile(f);
    expect(f.repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleSize: 1,
        warnings: ['BELOW_RECOMMENDED_SIZE', 'SAMPLE_CHANGED'],
      }),
    );
  });
  it('no guarda resultados parciales cuando falla OpenAI o su salida no es válida', async () => {
    const f = await fixture();
    f.text.generate.mockRejectedValueOnce(
      new ProviderError('openai', 'RATE_LIMITED'),
    );
    await expect(generateWritingProfile(f)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    f.text.generate.mockResolvedValueOnce({
      text: '{}',
      inputTokens: 1,
      outputTokens: 1,
    });
    await expect(generateWritingProfile(f)).rejects.toMatchObject({
      code: 'INVALID_PROFILE',
    });
    expect(f.repository.save).not.toHaveBeenCalled();
  });
  it('envía a OpenAI solo texto propio tras limpiar muestras guardadas', async () => {
    const f = await fixture();
    const original =
      'Hola Ana, he revisado tu propuesta y podemos comenzar el próximo lunes.';
    f.gmail = sentMailbox([
      sentEmail(
        0,
        {},
        `${original}\n\nSent from my iPhone\n\nEste mensaje contiene información confidencial dirigida exclusivamente a su destinatario. Si lo ha recibido por error, elimínelo.\n\n> Texto ajeno de otro remitente.`,
      ),
      sentEmail(
        1,
        {},
        'Este mensaje se ha generado automáticamente. No responda a este correo.',
      ),
    ]);
    await generateWritingProfile(f);
    const request = f.text.generate.mock.calls[0][0];
    expect(JSON.parse(request.input)).toEqual({
      examples: [{ example: 1, text: original }],
    });
    expect(f.repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleSize: 1,
        warnings: ['BELOW_RECOMMENDED_SIZE', 'SAMPLE_CHANGED'],
      }),
    );
    expect(JSON.stringify(f.repository.save.mock.calls)).not.toMatch(
      /iPhone|confidencial|Texto ajeno|propuesta/,
    );
  });
  it('no llama al modelo si ya no queda ningún ejemplo válido', async () => {
    const f = await fixture();
    f.gmail = sentMailbox([
      sentEmail(0, { labelIds: ['TRASH'] }),
      sentEmail(1, { labelIds: ['TRASH'] }),
    ]);
    await expect(generateWritingProfile(f)).rejects.toMatchObject({
      code: 'EMPTY_SAMPLE',
    });
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(f.repository.save).not.toHaveBeenCalled();
  });
});
