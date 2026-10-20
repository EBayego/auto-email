import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/providers/errors';
import {
  sampleNow,
  sampleOwner,
  sentEmail,
  sentMailbox,
  withHeaders,
} from '../../../tests/fixtures/sent-emails';
import {
  prepareSentSample,
  resolveSentSampleOptions,
  type StyleSampleMessage,
} from './sent-sample';

const options = { mailboxAddress: sampleOwner };
describe('MAIL-017, muestra efímera de enviados', () => {
  it('solo expone contexto del destinatario al solicitarlo y excluye destinatarios ambiguos de la agrupación', async () => {
    const raw = [
      sentEmail(0),
      withHeaders(sentEmail(1), { Cc: 'other@example.invalid' }),
      withHeaders(sentEmail(2), { To: sampleOwner }),
    ];
    await prepareSentSample(
      sentMailbox(raw),
      options,
      async (messages) => expect(messages.every((m) => !m.context)).toBe(true),
      sampleNow,
    );
    const manifest = await prepareSentSample(
      sentMailbox(raw),
      { ...options, includeRecipientContext: true },
      async (messages) => {
        expect(messages.find((m) => m.id === 'sent0')?.context?.recipient).toBe(
          'contact0@example.invalid',
        );
        expect(messages.find((m) => m.id === 'sent1')?.context).toBeUndefined();
        expect(messages.find((m) => m.id === 'sent2')?.context).toBeUndefined();
      },
      sampleNow,
    );
    expect(JSON.stringify(manifest)).not.toMatch(
      /recipient|contact0@example.invalid/,
    );
  });
  it('usa 12 meses, 200 ejemplos y un máximo de 500 candidatos', () => {
    expect(resolveSentSampleOptions(options, sampleNow)).toMatchObject({
      targetSize: 200,
      maxCandidates: 500,
      after: new Date('2025-10-18T12:00:00Z'),
      before: sampleNow,
    });
  });
  it.each([
    { targetSize: 199 },
    { targetSize: 501 },
    { targetSize: 200.5 },
    { maxCandidates: 501 },
    { maxCandidates: 100 },
    { after: sampleNow },
    { before: new Date('2027-01-01') },
    { after: new Date('invalid') },
    { excludedDomains: ['x) OR in:inbox'] },
    { excludedLabelIds: ['bad label'] },
    { excludedAddresses: ['bad'] },
    { aliases: ['not-email'] },
    { mailboxAddress: 'invalid' },
  ])(
    'rechaza opciones inválidas antes de consultar Gmail: %j',
    async (changes) => {
      const mailbox = sentMailbox([]);
      await expect(
        prepareSentSample(
          mailbox,
          { ...options, ...changes },
          undefined,
          sampleNow,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(mailbox.listMessages).not.toHaveBeenCalled();
    },
  );
  it('recupera 200–500 disponibles con paginación y variedad temporal, de destinatarios y longitudes', async () => {
    const emails = Array.from({ length: 340 }, (_, i) =>
      sentEmail(
        i,
        { internalDate: String(sampleNow.getTime() - (i + 1) * 86400000) },
        i % 3 === 0
          ? `Hola ${i}, ` +
              'Esta es una propuesta detallada sobre el trabajo que tenemos pendiente. '.repeat(
                20,
              )
          : undefined,
      ),
    );
    const mailbox = sentMailbox(emails);
    let count = 0;
    let retained: readonly StyleSampleMessage[] = [];
    const manifest = await prepareSentSample(
      mailbox,
      options,
      async (messages) => {
        count = messages.length;
        retained = messages;
        expect(messages.some((message) => message.length === 'long')).toBe(
          true,
        );
      },
      sampleNow,
    );
    expect(count).toBe(200);
    expect(retained).toHaveLength(0);
    expect(manifest.statistics).toMatchObject({
      scanned: 340,
      eligible: 340,
      selected: 200,
      uniqueRecipients: 10,
      uniqueThreads: 200,
    });
    expect(manifest.statistics.quarters.every((n) => n > 0)).toBe(true);
    expect(manifest.statistics.lengths.long).toBeGreaterThan(0);
    expect(manifest.warnings).toEqual([]);
    expect(
      mailbox.listMessages.mock.calls.every(
        ([query]) => query?.mailbox === 'sent' && query.maxResults! <= 25,
      ),
    ).toBe(true);
    expect(
      mailbox.listMessages.mock.calls.some(([query]) => query?.pageToken),
    ).toBe(true);
    const json = JSON.stringify(manifest);
    for (const privateValue of [
      sampleOwner,
      'authoredText',
      'Propuesta del proyecto',
      'he revisado',
      'payload',
      'original',
    ])
      expect(json).not.toContain(privateValue);
    expect(
      manifest.sourceMessages.every(
        (ref) => Object.keys(ref).sort().join() === 'id,threadId',
      ),
    ).toBe(true);
  });
  it('filtra etiquetas, contactos, alias, automáticos y reenvíos antes de descargar los cuerpos', async () => {
    const emails = [
      sentEmail(0),
      sentEmail(1, { labelIds: ['INBOX'] }),
      sentEmail(2, { labelIds: ['SENT', 'SPAM'] }),
      sentEmail(3, { labelIds: ['SENT', 'CATEGORY_PROMOTIONS'] }),
      withHeaders(sentEmail(4), { To: 'excluded@example.invalid' }),
      withHeaders(sentEmail(5), { Cc: 'private@team.blocked.invalid' }),
      withHeaders(sentEmail(6), { 'Auto-Submitted': 'auto-replied' }),
      withHeaders(sentEmail(7), { Subject: 'Re: Fwd: Consulta' }),
      withHeaders(sentEmail(8), { From: 'stranger@example.invalid' }),
      withHeaders(sentEmail(9), { From: 'alias@example.invalid' }),
      withHeaders(sentEmail(10), { Bcc: 'excluded@example.invalid' }),
    ];
    const mailbox = sentMailbox(emails);
    const result = await prepareSentSample(
      mailbox,
      {
        ...options,
        aliases: ['alias@example.invalid'],
        excludedLabelIds: ['CATEGORY_PROMOTIONS'],
        excludedAddresses: ['excluded@example.invalid'],
        excludedDomains: ['blocked.invalid'],
      },
      undefined,
      sampleNow,
    );
    expect(result.sourceMessages.map((ref) => ref.id).sort()).toEqual([
      'sent0',
      'sent9',
    ]);
    expect(result.statistics.excluded).toMatchObject({
      NOT_SENT: 1,
      EXCLUDED_LABEL: 2,
      EXCLUDED_CONTACT: 3,
      AUTOMATED: 1,
      FORWARDED: 1,
      UNTRUSTED_AUTHOR: 1,
    });
    expect(
      mailbox.getMessage.mock.calls
        .filter(([, query]) => query?.format === 'full')
        .map(([id]) => id)
        .sort(),
    ).toEqual(['sent0', 'sent9']);
  });
  it.each<Record<string, string>>([
    { 'Auto-Submitted': 'auto-generated; owner-email=secret' },
    { Precedence: 'bulk' },
    { 'List-Id': '<list.example.invalid>' },
    { 'List-Unsubscribe': '<mailto:private@example.invalid>' },
    { 'X-Autoreply': 'yes' },
    { 'X-Autorespond': 'yes' },
    { To: 'no-reply@example.invalid' },
    { Subject: 'Respuesta automática: vacaciones' },
    { Subject: 'Re: Out of office' },
  ])('detecta respuestas automáticas y listas con %j', async (headers) => {
    const mailbox = sentMailbox([withHeaders(sentEmail(0), headers)]);
    const result = await prepareSentSample(
      mailbox,
      options,
      undefined,
      sampleNow,
    );
    expect(result.statistics.excluded.AUTOMATED).toBe(1);
    expect(result.statistics.bodiesRead).toBe(0);
  });
  it('preserva correos normales con Auto-Submitted:no y no usa texto citado o firmas como muestra propia', async () => {
    const normal = withHeaders(
      sentEmail(
        0,
        {},
        'Hola, he revisado el proyecto y podemos comenzar el próximo lunes.\n\n-- \nFirma privada\n\n> Texto citado privado',
      ),
      { 'Auto-Submitted': 'no' },
    );
    const short = sentEmail(
      1,
      {},
      'Ok\n\nOn Tue, someone wrote:\n> ' + 'Texto citado antiguo. '.repeat(30),
    );
    const result = await prepareSentSample(
      sentMailbox([normal, short]),
      options,
      async (messages) => {
        expect(messages).toHaveLength(1);
        expect(messages[0].authoredText).not.toMatch(/Firma privada|citado/);
      },
      sampleNow,
    );
    expect(result.statistics.excluded.TOO_SHORT).toBe(1);
  });
  it('descarta duplicados de contenido, reenvíos inline y mensajes incompletos o demasiado grandes', async () => {
    const normal = sentEmail(0);
    const duplicate = { ...normal, id: 'copy', threadId: 'copy-thread' };
    const forward = sentEmail(
      1,
      {},
      'Hola, te hago llegar la información para el próximo proyecto.\n\n---------- Forwarded message ---------\nTexto de otra persona.',
    );
    const missing = sentEmail(2, {
      payload: {
        mimeType: 'text/plain',
        headers: normal.payload?.headers,
        body: { attachmentId: 'external-body', size: 100 },
      },
    });
    const big = sentEmail(3, { sizeEstimate: 2 * 1024 * 1024 });
    const result = await prepareSentSample(
      sentMailbox([normal, duplicate, forward, missing, big]),
      options,
      undefined,
      sampleNow,
    );
    expect(result.statistics).toMatchObject({
      selected: 1,
      bodiesRead: 4,
      excluded: {
        DUPLICATE_CONTENT: 1,
        FORWARDED: 1,
        INCOMPLETE_BODY: 1,
        TOO_LARGE: 1,
      },
    });
  });
  it('limita el escaneo aunque queden más mensajes y advierte de muestras pequeñas', async () => {
    const emails = Array.from({ length: 800 }, (_, i) =>
      sentEmail(i, {
        internalDate: String(sampleNow.getTime() - (i + 1) * 3600000),
      }),
    );
    const result = await prepareSentSample(
      sentMailbox(emails),
      { ...options, maxCandidates: 200 },
      undefined,
      sampleNow,
    );
    expect(result.statistics.scanned).toBe(200);
    expect(result.warnings).toContain('SCAN_LIMIT_REACHED');
    const small = await prepareSentSample(
      sentMailbox(emails.slice(0, 3)),
      options,
      undefined,
      sampleNow,
    );
    expect(small.statistics.selected).toBe(3);
    expect(small.warnings).toEqual(['BELOW_RECOMMENDED_SIZE']);
  });
  it('aplica limpieza avanzada antes de contar palabras y deduplicar la muestra', async () => {
    const original =
      'Hola, he revisado la propuesta y podemos comenzar el próximo lunes.';
    const legal =
      'Este mensaje contiene información confidencial dirigida exclusivamente a su destinatario. Si lo ha recibido por error, elimínelo.';
    const result = await prepareSentSample(
      sentMailbox([
        sentEmail(0, {}, `${original}\n\n${legal}`),
        sentEmail(1, {}, `${original}\n\nSent from my iPhone`),
        sentEmail(2, {}, `Ok\n\n${legal}`),
        sentEmail(
          3,
          {},
          'Este mensaje se ha generado automáticamente. No responda a este correo.',
        ),
        sentEmail(
          4,
          {},
          'Oferta semanal.\n\nRecibes este correo porque te has suscrito a nuestra lista. Puedes darte de baja aquí.',
        ),
      ]),
      options,
      async (messages) => {
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
          authoredText: original,
          wordCount: 11,
          length: 'short',
        });
      },
      sampleNow,
    );
    expect(result.statistics).toMatchObject({
      eligible: 1,
      averageWords: 11,
      excluded: { DUPLICATE_CONTENT: 1, TOO_SHORT: 1, AUTOMATED: 2 },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /confidencial|iPhone|Oferta semanal|authoredText/,
    );
  });
  it('conserva texto propio de respuestas Outlook sin confundir el historial con un reenvío', async () => {
    const original =
      'Hola, he revisado la propuesta y podemos comenzar el próximo lunes.';
    const result = await prepareSentSample(
      sentMailbox([
        sentEmail(
          0,
          {},
          `${original}\n\n-----Original Message-----\nFrom: Other\nMensaje anterior sin prefijos.`,
        ),
      ]),
      options,
      async (messages) => {
        expect(messages).toHaveLength(1);
        expect(messages[0].authoredText).toBe(original);
      },
      sampleNow,
    );
    expect(result.statistics.excluded.FORWARDED).toBe(0);
  });
  it('acepta un buzón sin enviados y devuelve estadísticas vacías', async () => {
    const result = await prepareSentSample(
      sentMailbox([]),
      options,
      undefined,
      sampleNow,
    );
    expect(result.sourceMessages).toEqual([]);
    expect(result.statistics).toMatchObject({
      scanned: 0,
      selected: 0,
      averageWords: 0,
      oldestAt: null,
    });
  });
  it('rechaza cursores repetidos sin reintentar indefinidamente', async () => {
    const mailbox = sentMailbox([]);
    mailbox.listMessages.mockResolvedValue({
      messages: [],
      nextPageToken: 'same',
    });
    await expect(
      prepareSentSample(mailbox, options, undefined, sampleNow),
    ).rejects.toMatchObject({ code: 'INVALID_PAGE' });
    expect(mailbox.listMessages).toHaveBeenCalledTimes(5);
  });
  it('tolera mensajes desaparecidos, pero propaga cuotas y fallos de autorización sin resultados parciales', async () => {
    const mailbox = sentMailbox([sentEmail(0)]);
    mailbox.getMessage.mockRejectedValue(
      new ProviderError('google', 'NOT_FOUND'),
    );
    expect(
      (await prepareSentSample(mailbox, options, undefined, sampleNow))
        .statistics.excluded.INVALID_MESSAGE,
    ).toBe(1);
    const consume = vi.fn();
    mailbox.getMessage.mockRejectedValue(
      new ProviderError('google', 'RATE_LIMITED'),
    );
    await expect(
      prepareSentSample(mailbox, options, consume, sampleNow),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(consume).not.toHaveBeenCalled();
  });
  it('descarta las referencias temporales incluso si falla el siguiente procesador', async () => {
    let retained: readonly StyleSampleMessage[] = [];
    await expect(
      prepareSentSample(
        sentMailbox([sentEmail(0)]),
        options,
        async (messages) => {
          retained = messages;
          throw new Error('consumer failed');
        },
        sampleNow,
      ),
    ).rejects.toThrow('consumer failed');
    expect(retained).toHaveLength(0);
  });
});
