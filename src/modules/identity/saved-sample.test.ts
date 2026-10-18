import { describe, expect, it } from 'vitest';
import {
  sampleNow,
  sampleOwner,
  sentEmail,
  sentMailbox,
} from '../../../tests/fixtures/sent-emails';
import { prepareSentSample } from './sent-sample';
import { withSavedSentSample } from './saved-sample';
describe('recuperación de la muestra seleccionada de MAIL-017', () => {
  it('solo recupera referencias guardadas y revalida filtros sin escanear otros enviados', async () => {
    const messages = Array.from({ length: 30 }, (_, i) => sentEmail(i));
    const manifest = await prepareSentSample(
      sentMailbox(messages),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    const client = sentMailbox([...messages, sentEmail(100)]);
    let size = 0;
    await withSavedSentSample(
      client,
      manifest,
      { mailboxAddress: sampleOwner },
      async (examples) => {
        size = examples.length;
      },
      sampleNow,
    );
    expect(size).toBe(30);
    expect(client.listMessages).not.toHaveBeenCalled();
    expect(client.getMessage.mock.calls.some(([id]) => id === 'sent100')).toBe(
      false,
    );
  });
  it('revalida etiquetas y excluye mensajes que ahora están en papelera', async () => {
    const message = sentEmail(0);
    const manifest = await prepareSentSample(
      sentMailbox([message]),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    const result = await withSavedSentSample(
      sentMailbox([{ ...message, labelIds: ['SENT', 'TRASH'] }]),
      manifest,
      { mailboxAddress: sampleOwner },
      async (examples) => {
        expect(examples).toHaveLength(0);
      },
      sampleNow,
    );
    expect(result.statistics.excluded.EXCLUDED_LABEL).toBe(1);
  });
  it('rechaza muestras caducadas o duplicadas antes de tocar Gmail', async () => {
    const manifest = await prepareSentSample(
      sentMailbox([sentEmail(0)]),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    const client = sentMailbox([]);
    await expect(
      withSavedSentSample(
        client,
        manifest,
        { mailboxAddress: sampleOwner },
        async () => {},
        new Date(manifest.expiresAt),
      ),
    ).rejects.toMatchObject({ code: 'SAMPLE_REQUIRED' });
    await expect(
      withSavedSentSample(
        client,
        {
          ...manifest,
          sourceMessages: [
            ...manifest.sourceMessages,
            ...manifest.sourceMessages,
          ],
        },
        { mailboxAddress: sampleOwner },
        async () => {},
        sampleNow,
      ),
    ).rejects.toMatchObject({ code: 'SAMPLE_REQUIRED' });
    expect(client.getMessage).not.toHaveBeenCalled();
  });
});
