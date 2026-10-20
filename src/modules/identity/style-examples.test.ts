import { describe, expect, it } from 'vitest';
import { prepareSentSample } from './sent-sample';
import { loadStyleExamples } from './style-examples';
import {
  sampleNow,
  sampleOwner,
  sentEmail,
  sentMailbox,
} from '../../../tests/fixtures/sent-emails';
describe('ejemplos efímeros para el generador', () => {
  it('consulta solo tres referencias aprobadas, sin citas, firmas ni IDs en los ejemplos', async () => {
    const emails = Array.from({ length: 5 }, (_, i) =>
      sentEmail(
        i,
        {},
        `Hola, he revisado la propuesta del proyecto ${i} y podemos hablar de los siguientes pasos.\n\n-- \nprivate-signature\n> private-quote`,
      ),
    );
    const manifest = await prepareSentSample(
      sentMailbox(emails),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    const client = sentMailbox(emails);
    const examples = await loadStyleExamples(
      client,
      manifest,
      { mailboxAddress: sampleOwner },
      3,
      sampleNow,
    );
    expect(examples).toHaveLength(3);
    expect(
      examples.every((example) => Object.keys(example).join() === 'text'),
    ).toBe(true);
    expect(JSON.stringify(examples)).not.toMatch(
      /private-signature|private-quote|threadId/,
    );
    expect(client.listMessages).not.toHaveBeenCalled();
    expect(new Set(client.getMessage.mock.calls.map(([id]) => id)).size).toBe(
      3,
    );
  });
  it('no lee Gmail cuando no hay muestra o se deshabilitan ejemplos', async () => {
    const client = sentMailbox([]);
    expect(
      await loadStyleExamples(client, null, { mailboxAddress: sampleOwner }),
    ).toEqual([]);
    expect(client.getMessage).not.toHaveBeenCalled();
    await expect(
      loadStyleExamples(client, null, { mailboxAddress: sampleOwner }, 4),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('limpia avisos y firmas al recuperar referencias anteriores y excluye plantillas', async () => {
    const manifest = await prepareSentSample(
      sentMailbox([sentEmail(0), sentEmail(1)]),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    const original =
      'Hola, he revisado la propuesta y podemos comenzar el próximo lunes.';
    const client = sentMailbox([
      sentEmail(
        0,
        {},
        `${original}\n\nEnviado desde Outlook para Android\n\nEste mensaje contiene información confidencial dirigida exclusivamente a su destinatario. Si lo ha recibido por error, elimínelo.`,
      ),
      sentEmail(
        1,
        {},
        'This is an automatically generated message. Please do not reply to this email.',
      ),
    ]);
    expect(
      await loadStyleExamples(
        client,
        manifest,
        { mailboxAddress: sampleOwner },
        3,
        sampleNow,
      ),
    ).toEqual([{ text: original }]);
    expect(client.listMessages).not.toHaveBeenCalled();
    expect(new Set(client.getMessage.mock.calls.map(([id]) => id))).toEqual(
      new Set(['sent0', 'sent1']),
    );
  });
  it('acota textos largos conservando el principio y el cierre', async () => {
    const email = sentEmail(
      0,
      {},
      'APERTURA ' + 'explicación '.repeat(400) + ' CIERRE',
    );
    const manifest = await prepareSentSample(
      sentMailbox([email]),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    const examples = await loadStyleExamples(
      sentMailbox([email]),
      manifest,
      { mailboxAddress: sampleOwner },
      1,
      sampleNow,
    );
    expect(examples[0].text.length).toBeLessThanOrEqual(2000);
    expect(examples[0].text).toMatch(/^APERTURA/);
    expect(examples[0].text).toMatch(/CIERRE$/);
  });
});
