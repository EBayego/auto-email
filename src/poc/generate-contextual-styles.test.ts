import { describe, expect, it, vi } from 'vitest';
import {
  sentEmail,
  sentMailbox,
  sampleOwner,
  sampleNow,
} from '../../tests/fixtures/sent-emails';
import {
  writingProfileFixture,
  writingProfileRow,
} from '../../tests/fixtures/writing-profile';
import { prepareSentSample } from '@/modules/identity/sent-sample';
import { generateContextualStyles } from './generate-contextual-styles';

async function fixture(count = 30) {
  const gmail = sentMailbox(
    Array.from({ length: count }, (_, i) => sentEmail(i)),
  );
  const manifest = await prepareSentSample(
    gmail,
    { mailboxAddress: sampleOwner },
    undefined,
    sampleNow,
  );
  const contextual = {
    ...writingProfileFixture(),
    formality: 'high',
    language: 'en',
  };
  const text = {
    generate: vi.fn().mockResolvedValue({
      text: JSON.stringify(contextual),
      inputTokens: 10,
      outputTokens: 10,
    }),
  };
  const save = vi
    .fn()
    .mockResolvedValue({ revision: writingProfileRow().revision, version: 1 });
  return {
    gmail,
    manifest,
    text,
    save,
    mailboxAddress: sampleOwner,
    model: 'test-model',
    general: {
      revision: writingProfileRow().revision,
      profile: writingProfileFixture(),
    },
    rules: [],
    now: sampleNow,
  };
}
describe('MAIL-025, generación contextual desde referencias de la muestra autorizada', () => {
  it('analiza el grupo en memoria, registra evidencia y no envía destinatarios ni categorías al modelo', async () => {
    const f = await fixture();
    const report = await generateContextualStyles(f);
    expect(report.generated).toBe(1);
    expect(f.save).toHaveBeenCalledWith(
      { kind: 'DOMAIN', key: 'example.invalid' },
      expect.objectContaining({
        sampleSize: 30,
        context: {
          parentRevision: f.general.revision,
          evidence: { threads: 30, recipients: 10, words: 570, days: 30 },
        },
      }),
    );
    expect(report.profiles[0].variations).toEqual(['formality', 'language']);
    expect(f.text.generate.mock.calls[0][0].input).not.toMatch(
      /example.invalid|sent0|thread0|DOMAIN|CLIENT/,
    );
    expect(JSON.stringify(report)).not.toMatch(
      /example.invalid|authoredText|propuesta/,
    );
  });
  it('no llama al modelo ni guarda perfiles si no hay evidencia suficiente', async () => {
    const f = await fixture(5);
    expect((await generateContextualStyles(f)).generated).toBe(0);
    expect(f.text.generate).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it('propaga un fallo de análisis sin guardar ese perfil', async () => {
    const f = await fixture();
    f.text.generate.mockResolvedValueOnce({
      text: '{}',
      inputTokens: 1,
      outputTokens: 1,
    });
    await expect(generateContextualStyles(f)).rejects.toMatchObject({
      code: 'INVALID_PROFILE',
    });
    expect(f.save).not.toHaveBeenCalled();
  });
});
