import { describe, expect, it, vi } from 'vitest';
import type { GmailClient, GmailMessage } from '@/providers/contracts';
import { ProviderError } from '@/providers/errors';
import {
  sampleNow,
  sampleOwner,
  sentEmail,
  sentMailbox,
  withHeaders,
} from '../../../tests/fixtures/sent-emails';
import { writingProfileFixture } from '../../../tests/fixtures/writing-profile';
import {
  createStyleExampleRetriever,
  styleExampleLimits,
} from './style-example-retriever';
import { prepareSentSample } from './sent-sample';

const recipient = 'client@example.invalid';
const request = {
  accountId: 'account-26',
  recipient,
  threadId: 'current-thread',
  subject: 'Auditoría energética',
  text: 'Hola, ¿puedes revisar la auditoría energética del edificio? Gracias.',
  now: sampleNow,
  profile: writingProfileFixture(),
};
function email(
  index: number,
  text = `Hola, he revisado la auditoría energética del edificio y adjunto mis observaciones sobre aislamiento ${index}. Gracias.`,
  to = recipient,
) {
  return withHeaders(sentEmail(index, {}, text), {
    To: to,
    Subject: 'Re: Auditoría energética',
    'In-Reply-To': `<incoming-${index}@example.invalid>`,
  });
}
function fixture(messages: GmailMessage[] = []) {
  const mailbox = sentMailbox(messages);
  const listMessages = vi.fn<GmailClient['listMessages']>(async (query) => ({
    messages: messages
      .filter(
        (message) =>
          !query?.to ||
          message.payload?.headers?.some(
            ({ name, value }) => name === 'To' && value === query.to,
          ),
      )
      .slice(0, query?.maxResults)
      .map(({ id, threadId }) => ({ id, threadId })),
  }));
  const gmail = { ...mailbox, listMessages };
  const identity = {
    accountId: request.accountId,
    mailboxAddress: sampleOwner,
  };
  return {
    gmail,
    identity,
    retriever: createStyleExampleRetriever({ gmail, identity }),
  };
}

describe('StyleExampleRetriever (MAIL-026)', () => {
  it('excluye mensajes nuevos mínimos como ejemplo de respuesta sin descartar respuestas auténticas breves', async () => {
    const short = 'Hola, gracias por el mensaje y la información. Saludos.';
    const newMessage = withHeaders(email(0, short), {
      'In-Reply-To': '',
      References: '',
      Subject: 'Auditoría energética',
    });
    const reply = email(1, short);
    expect(await fixture([newMessage]).retriever.retrieve(request)).toEqual([]);
    expect(await fixture([reply]).retriever.retrieve(request)).toHaveLength(1);
  });
  it('evita contaminar el idioma objetivo con ejemplos de otro idioma del mismo destinatario', async () => {
    const f = fixture([
      email(
        0,
        'Hola, he recibido tu mensaje y agradezco que hayas compartido toda la información.',
      ),
      email(
        1,
        'Hello, thank you for your message. I have received your email and appreciate the information.',
      ),
    ]);
    const result = await f.retriever.retrieve({
      ...request,
      text: 'Hello, please confirm that you have received my email. Thank you.',
    });
    expect(result).toHaveLength(1);
    expect(result[0].text).toMatch(/^Hello/);
    const explicit = await f.retriever.retrieve({ ...request, language: 'en' });
    expect(explicit).toHaveLength(1);
    expect(explicit[0].text).toMatch(/^Hello/);
  });
  it('recupera exclusivamente el conjunto de referencias fijado para una evaluación', async () => {
    const f = fixture([email(0), email(1)]);
    const retriever = createStyleExampleRetriever({
      ...f,
      sourceReferences: [{ id: 'sent1', threadId: 'thread1' }],
    });
    expect(await retriever.retrieve(request)).toHaveLength(1);
    expect(f.gmail.listMessages).not.toHaveBeenCalled();
    expect(f.gmail.getMessage.mock.calls.every(([id]) => id === 'sent1')).toBe(
      true,
    );
  });
  it('busca contacto y temática con fechas y límites, sin paginar ni persistir contenido', async () => {
    const f = fixture([email(0)]);
    f.gmail.listMessages.mockResolvedValue({
      messages: [{ id: 'sent0', threadId: 'thread0' }],
      nextPageToken: 'ignored',
    });
    const examples = await f.retriever.retrieve(request);
    expect(examples).toHaveLength(1);
    expect(Object.keys(examples[0])).toEqual(['text']);
    expect(f.gmail.listMessages).toHaveBeenCalledTimes(2);
    expect(f.gmail.listMessages).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        mailbox: 'sent',
        to: recipient,
        before: sampleNow,
        maxResults: 20,
      }),
    );
    expect(f.gmail.listMessages).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        mailbox: 'sent',
        textTerms: ['auditoria', 'energetica'],
      }),
    );
    expect(
      f.gmail.getMessage.mock.calls.map(([, options]) => options?.format),
    ).toEqual(['metadata', 'full']);
    expect(JSON.stringify(examples)).not.toMatch(
      /thread0|sent0|client@|In-Reply-To/,
    );
  });
  it('prioriza el mismo destinatario, luego similitud temática y recencia', async () => {
    const contact = email(
      20,
      'Buenos días, me parece bien el cambio de formato del informe y los párrafos que propones.',
    );
    const recentTopic = email(
      0,
      'La auditoría energética contempla revisar la climatización del edificio antes de presentar conclusiones.',
      'other@example.invalid',
    );
    const oldTopic = email(
      50,
      'El estudio de auditoría energética permite analizar las pérdidas térmicas y comparar resultados anteriores.',
      'third@example.invalid',
    );
    const unrelated = withHeaders(
      email(
        1,
        'Los ingredientes de la receta deben mezclarse durante varios minutos antes de cocinar.',
        'fourth@example.invalid',
      ),
      { Subject: 'Re: Cocina' },
    );
    const f = fixture([oldTopic, unrelated, recentTopic, contact]);
    const examples = await f.retriever.retrieve(request);
    expect(examples.map(({ text }) => text)).toEqual([
      expect.stringContaining('formato'),
      expect.stringContaining('climatización'),
      expect.stringContaining('pérdidas'),
    ]);
  });
  it('prefiere respuestas y longitud representativa cuando la relevancia es equivalente', async () => {
    const original = withHeaders(
      sentEmail(
        0,
        {},
        'Hola, he revisado el formato del documento y me parece adecuado para presentar las conclusiones.',
      ),
      { To: recipient, Subject: 'Formato' },
    );
    const reply = withHeaders(
      email(
        0,
        'Hola, la estructura del informe está clara y la explicación resulta fácil de seguir.',
      ),
      { 'Message-ID': '<reply@example.invalid>' },
    );
    const changed = { ...reply, id: 'reply', threadId: 'reply-thread' };
    const f = fixture([original, changed]);
    const examples = await f.retriever.retrieve({
      ...request,
      subject: null,
      text: 'Hola, gracias.',
      limit: 1,
    });
    expect(examples[0].text).toContain('estructura');
  });
  it('favorece un ejemplo más reciente en igualdad de relevancia', async () => {
    const f = fixture([
      email(
        40,
        'Hola, el formato está preparado y la estructura parece correcta para continuar con el trabajo.',
      ),
      email(
        0,
        'Buenas, la explicación resulta clara y los párrafos son breves para facilitar una lectura cómoda.',
      ),
    ]);
    expect(
      (await f.retriever.retrieve({ ...request, limit: 1 }))[0].text,
    ).toContain('lectura cómoda');
  });
  it('reutiliza referencias vigentes del perfil general aunque las búsquedas no devuelvan resultados', async () => {
    const f = fixture([email(0)]);
    const sample = await prepareSentSample(
      f.gmail,
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    f.gmail.listMessages.mockResolvedValue({ messages: [] });
    const retriever = createStyleExampleRetriever({ ...f, sample });
    expect(await retriever.retrieve(request)).toHaveLength(1);
    const expired = { ...sample, expiresAt: '2026-10-17T00:00:00Z' };
    f.gmail.getMessage.mockClear();
    expect(
      await createStyleExampleRetriever({ ...f, sample: expired }).retrieve(
        request,
      ),
    ).toEqual([]);
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
  });
  it('funciona sin muestra ni ejemplos particulares y no conserva referencias de una petición anterior', async () => {
    const f = fixture([email(0)]);
    expect(await f.retriever.retrieve(request)).toHaveLength(1);
    f.gmail.listMessages.mockResolvedValue({ messages: [] });
    f.gmail.getMessage.mockClear();
    expect(await f.retriever.retrieve(request)).toEqual([]);
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
  });
  it('limpia firmas, avisos legales y citas antes de devolver el ejemplo', async () => {
    const f = fixture([
      email(
        0,
        'Hola, he revisado la auditoría energética y el informe contiene las observaciones necesarias.\n\nEnviado desde mi iPhone\n> private-quote',
      ),
    ]);
    const result = await f.retriever.retrieve(request);
    expect(result).toHaveLength(1);
    expect(result[0].text).not.toMatch(/iPhone|private-quote/);
  });
  it('excluye mensajes ajenos, automatizados, reenviados, ambiguos y fuera de fecha antes de leer cuerpos', async () => {
    const f = fixture([
      withHeaders(email(0), { From: 'stranger@example.invalid' }),
      withHeaders(email(1), { 'Auto-Submitted': 'auto-generated' }),
      withHeaders(email(2), { Subject: 'Fwd: Auditoría energética' }),
      withHeaders(email(3), { Cc: 'second@example.invalid' }),
      { ...email(4), labelIds: ['INBOX'] },
      { ...email(5), internalDate: String(sampleNow.getTime() + 1000) },
      {
        ...email(6),
        internalDate: String(sampleNow.getTime() - 400 * 86400000),
      },
      { ...email(7), sizeEstimate: 2 * 1024 * 1024 },
      withHeaders(email(8), { To: sampleOwner }),
    ]);
    expect(await f.retriever.retrieve(request)).toEqual([]);
    expect(
      f.gmail.getMessage.mock.calls.every(
        ([, options]) => options?.format === 'metadata',
      ),
    ).toBe(true);
  });
  it('revalida el cuerpo y el destinatario si cambian tras consultar metadatos', async () => {
    const f = fixture([email(0)]);
    const original = f.gmail.getMessage.getMockImplementation()!;
    f.gmail.getMessage.mockImplementation((id, options) =>
      options?.format === 'full'
        ? Promise.resolve(
            withHeaders(
              email(
                0,
                'Esta receta lleva harina, huevos y leche y debe cocinarse despacio.',
              ),
              { To: 'other@example.invalid', Subject: 'Re: Cocina' },
            ),
          )
        : original(id, options),
    );
    expect(await f.retriever.retrieve(request)).toEqual([]);
  });
  it('descarta plantillas, texto heredado y mensajes incompletos en la lectura completa', async () => {
    const f = fixture([
      email(
        0,
        'This is an automatically generated message. Please do not reply to this email.',
      ),
      email(
        1,
        'Hola, gracias.\n\n---------- Forwarded message ---------\nFrom: Other <other@example.invalid>\nEsta es información ajena que no debe utilizarse como estilo.',
      ),
      {
        ...email(2),
        payload: {
          ...email(2).payload,
          body: { attachmentId: 'not-loaded', size: 1000 },
        },
      },
    ]);
    expect(await f.retriever.retrieve(request)).toEqual([]);
  });
  it('no reutiliza mensajes del hilo actual ni posteriores al objetivo aunque Gmail los devuelva', async () => {
    const f = fixture([
      { ...email(0), threadId: request.threadId },
      {
        ...email(1),
        internalDate: String(new Date('2026-08-03T00:00:00Z').getTime()),
      },
    ]);
    expect(
      await f.retriever.retrieve({
        ...request,
        before: new Date('2026-08-02T00:00:00Z'),
      }),
    ).toHaveLength(0);
    expect(f.gmail.getMessage.mock.calls.map(([id]) => id)).toEqual(['sent1']);
  });
  it('usa un ejemplo por hilo y elimina cuerpos duplicados y casi duplicados', async () => {
    const duplicate =
      'Hola, he revisado la auditoría energética del edificio y las conclusiones resultan claras para continuar.';
    const f = fixture([
      email(0, duplicate),
      email(1, duplicate),
      email(2, duplicate + ' Saludos.'),
      {
        ...email(
          3,
          'El informe del aislamiento está preparado y podemos comentar sus resultados en nuestra próxima conversación.',
        ),
        threadId: 'thread0',
      },
    ]);
    expect(await f.retriever.retrieve(request)).toHaveLength(1);
  });
  it('no gasta el presupuesto de cuerpos en respuestas sucesivas de una sola conversación', async () => {
    const sameThread = Array.from({ length: 15 }, (_, i) => ({
      ...email(i),
      threadId: 'repeated-thread',
    }));
    const other = email(
      20,
      'El análisis del aislamiento del edificio está preparado y el informe resume los resultados de manera clara.',
    );
    const f = fixture([...sameThread, other]);
    expect(await f.retriever.retrieve(request)).toHaveLength(2);
    expect(
      f.gmail.getMessage.mock.calls.filter(
        ([, options]) => options?.format === 'full',
      ),
    ).toHaveLength(2);
  });
  it('acota el número de cuerpos y ejemplos y conserva apertura y cierre de textos largos', async () => {
    const f = fixture(
      Array.from({ length: 20 }, (_, i) =>
        email(
          i,
          i === 0
            ? 'APERTURA ' + 'explicación '.repeat(400) + ' CIERRE'
            : `Texto de respuesta auténtica con observaciones originales sobre el asunto numero ${i} y siguientes pasos.`,
        ),
      ),
    );
    const examples = await f.retriever.retrieve(request);
    expect(examples.length).toBeLessThanOrEqual(3);
    expect(
      f.gmail.getMessage.mock.calls.filter(
        ([, options]) => options?.format === 'full',
      ),
    ).toHaveLength(styleExampleLimits.bodies);
    const long = await fixture([
      email(0, 'APERTURA ' + 'explicación '.repeat(400) + ' CIERRE'),
    ]).retriever.retrieve(request);
    expect(long[0].text).toMatch(/^APERTURA[\s\S]*CIERRE$/);
    expect(long[0].text.length).toBeLessThanOrEqual(2000);
  });
  it('acota los metadatos aunque haya una muestra de 500 referencias', async () => {
    const f = fixture(Array.from({ length: 200 }, (_, i) => email(i)));
    const sample = await prepareSentSample(
      sentMailbox(Array.from({ length: 200 }, (_, i) => email(i))),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
    f.gmail.getMessage.mockClear();
    await createStyleExampleRetriever({ ...f, sample }).retrieve(request);
    expect(
      f.gmail.getMessage.mock.calls.filter(
        ([, options]) => options?.format === 'metadata',
      ),
    ).toHaveLength(60);
  });
  it('no consulta credenciales ni Gmail para otra cuenta o una muestra de otro titular', async () => {
    const f = fixture([email(0)]);
    await expect(
      f.retriever.retrieve({ ...request, accountId: 'other-account' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
    const sample = { gmailAccountId: 'other-account' } as never;
    await expect(
      createStyleExampleRetriever({ ...f, sample }).retrieve(request),
    ).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
    expect(f.gmail.listMessages).not.toHaveBeenCalled();
    expect(f.gmail.getMessage).not.toHaveBeenCalled();
  });
  it('mantiene clientes y resultados separados entre dos cuentas concurrentes', async () => {
    const first = fixture([
      email(
        0,
        'Hola, he revisado el documento de la primera cuenta y tengo observaciones para compartir.',
      ),
    ]);
    const second = fixture([
      withHeaders(
        email(
          0,
          'Buenos días, la segunda cuenta dispone de un informe diferente para comentar con calma.',
        ),
        { From: 'second@example.invalid' },
      ),
    ]);
    const other = createStyleExampleRetriever({
      gmail: second.gmail,
      identity: {
        accountId: 'second-account',
        mailboxAddress: 'second@example.invalid',
      },
    });
    const [a, b] = await Promise.all([
      first.retriever.retrieve(request),
      other.retrieve({ ...request, accountId: 'second-account' }),
    ]);
    expect(a[0].text).toContain('primera cuenta');
    expect(b[0].text).toContain('segunda cuenta');
    expect(JSON.stringify(a)).not.toContain('segunda cuenta');
  });
  it.each([
    'AUTHENTICATION_FAILED',
    'PERMISSION_DENIED',
    'RATE_LIMITED',
    'UNAVAILABLE',
  ] as const)(
    'propaga %s sin ocultar problemas de autorización o proveedor',
    async (code) => {
      const f = fixture([email(0)]);
      f.gmail.getMessage.mockRejectedValue(new ProviderError('google', code));
      await expect(f.retriever.retrieve(request)).rejects.toMatchObject({
        code,
      });
    },
  );
  it('tolera referencias eliminadas y respuestas con identidad incorrecta', async () => {
    const f = fixture([email(0), email(1)]);
    f.gmail.getMessage
      .mockRejectedValueOnce(new ProviderError('google', 'NOT_FOUND'))
      .mockResolvedValueOnce({ ...email(1), id: 'wrong-id' });
    expect(await f.retriever.retrieve(request)).toEqual([]);
  });
  it('propaga errores en el listado en lugar de hacer un fallback que ignore permisos', async () => {
    const f = fixture();
    f.gmail.listMessages.mockRejectedValue(
      new ProviderError('google', 'PERMISSION_DENIED'),
    );
    await expect(f.retriever.retrieve(request)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
  it.each([
    { limit: -1 },
    { limit: 4 },
    { recipient: 'a@b OR in:anywhere' },
    { now: new Date(NaN) },
    { before: new Date(NaN) },
    { threadId: '../other' },
    { preferredMessageIds: ['bad id'] },
  ])('rechaza entradas inválidas antes de Gmail: %j', async (change) => {
    const f = fixture();
    await expect(
      f.retriever.retrieve({ ...request, ...change }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.gmail.listMessages).not.toHaveBeenCalled();
  });
  it('no lee historial con límite cero o un objetivo anterior a la ventana', async () => {
    const f = fixture();
    expect(await f.retriever.retrieve({ ...request, limit: 0 })).toEqual([]);
    expect(
      await f.retriever.retrieve({
        ...request,
        before: new Date('2024-01-01'),
      }),
    ).toEqual([]);
    expect(f.gmail.listMessages).not.toHaveBeenCalled();
  });
});
