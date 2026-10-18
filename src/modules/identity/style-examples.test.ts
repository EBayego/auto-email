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
