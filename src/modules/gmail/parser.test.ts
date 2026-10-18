import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type { GmailMessage, GmailMessagePart } from '@/providers/contracts';
import { createGmailClient } from '@/providers/gmail';
import { createEmailFixtures } from '../../../tests/fixtures/emails';
import { emailLimits } from './email';
import { getNormalizedMessage, parseGmailMessage } from './parser';

const headers = [
  { name: 'From', value: 'Marta <marta@example.invalid>' },
  { name: 'To', value: 'Owner <owner@example.invalid>' },
  { name: 'Subject', value: 'Consulta sintética' },
  { name: 'Message-ID', value: '<message-15@example.invalid>' },
  { name: 'Date', value: 'Sat, 17 Oct 2026 09:00:00 +0200' },
];
const base = {
  id: 'message-15',
  threadId: 'thread-15',
  labelIds: ['INBOX'],
  internalDate: '1792234800000',
};
function part(
  text: string | Buffer,
  mimeType = 'text/plain',
  extra: Partial<GmailMessagePart> = {},
): GmailMessagePart {
  return {
    mimeType,
    headers: [],
    body: {
      data: Buffer.from(text).toString('base64url'),
      size: Buffer.byteLength(text),
    },
    ...extra,
  };
}
function message(payload: GmailMessagePart = part('Hola.')): GmailMessage {
  return {
    ...base,
    payload: { ...payload, headers: [...headers, ...(payload.headers ?? [])] },
  };
}
function rawMessage(body: string, extraHeaders: string[] = []): GmailMessage {
  const raw = [
    ...headers.map(({ name, value }) => `${name}: ${value}`),
    ...extraHeaders,
    '',
    body,
  ].join('\r\n');
  return { ...base, raw: Buffer.from(raw).toString('base64url') };
}

describe('parser y normalizador de correos (MAIL-015)', () => {
  it('conserva respuestas intercaladas tras una atribución citada partida entre líneas', async () => {
    const result = await parseGmailMessage(
      message(
        part(
          'On Friday, 16 October 2026,\nAna <ana@example.invalid> wrote:\n> ¿Martes?\nSí, a las diez.\n> ¿Online?\nPrefiero presencial.',
        ),
      ),
    );
    expect(result.authoredText).toBe('Sí, a las diez.\n\nPrefiero presencial.');
    expect(result.warnings).not.toContain('AMBIGUOUS_QUOTE');
  });
  it.each([
    'On Friday, 16 October 2026 at 10:00,\nAna <ana@example.invalid> wrote:',
    'El viernes, 16 de octubre de 2026,\nAna <ana@example.invalid> escribió:',
  ])(
    'identifica una atribución citada partida entre líneas (%s)',
    async (attribution) => {
      const result = await parseGmailMessage(
        message(
          part(
            `Respuesta actual.\n\n${attribution}\nTexto anterior sin prefijos.`,
          ),
        ),
      );
      expect(result.authoredText).toBe('Respuesta actual.');
      expect(result.bodyText).toContain('Texto anterior sin prefijos.');
      expect(result.segments.at(-1)?.kind).toBe('quoted');
      expect(result.warnings).toContain('AMBIGUOUS_QUOTE');
    },
  );

  it('extrae metadatos y texto Unicode sin modificar el original ni retenerlo por defecto', async () => {
    const input = createEmailFixtures().pending.messages[0];
    const before = structuredClone(input);
    const result = await parseGmailMessage(input);
    expect(result).toMatchObject({
      id: input.id,
      threadId: input.threadId,
      labels: ['INBOX'],
      from: [{ name: '', address: 'contact@example.invalid' }],
      to: [{ name: '', address: 'owner@example.invalid' }],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: 'Consulta sintética sobre una reunión',
      internetMessageId: `<${input.id}@example.invalid>`,
      sentAt: '2026-10-17T09:00:00.000Z',
      receivedAt: new Date(Number(input.internalDate)).toISOString(),
      bodyText: 'Hola, ¿podemos reunirnos el próximo martes? Gracias.',
      authoredText: 'Hola, ¿podemos reunirnos el próximo martes? Gracias.',
      bodyStatus: 'complete',
      isEmpty: false,
      hasAttachments: false,
      warnings: [],
    });
    expect(result).not.toHaveProperty('original');
    expect(input).toEqual(before);
    expect(
      (await parseGmailMessage(input, { retainOriginal: true })).original,
    ).toBe(input);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('decodifica cabeceras MIME, respeta comas entrecomilladas y expande grupos de destinatarios', async () => {
    const input = message(part('Sí, disponible.'));
    const result = await parseGmailMessage({
      ...input,
      payload: {
        ...input.payload,
        headers: [
          {
            name: 'fRoM',
            value: '=?UTF-8?Q?Jos=C3=A9_P=C3=A9rez?= <jose@example.invalid>',
          },
          {
            name: 'To',
            value:
              'Team: "Doe, Jane" <jane@example.invalid>, Bob <bob@example.invalid>;',
          },
          {
            name: 'CC',
            value:
              '=?utf-8?B?TWFyw61h?= <maria@example.invalid>, jane@example.invalid',
          },
          { name: 'Bcc', value: 'blind@example.invalid' },
          { name: 'Reply-To', value: 'Support <support@example.invalid>' },
          {
            name: 'Subject',
            value: '=?UTF-8?Q?Reuni=C3=B3n?=\r\n\t=?UTF-8?Q?_ma=C3=B1ana?=',
          },
          { name: 'Message-ID', value: '<current@example.invalid>' },
          { name: 'In-Reply-To', value: '<previous@example.invalid>' },
          {
            name: 'References',
            value: '<first@example.invalid>\r\n <previous@example.invalid>',
          },
        ],
      },
    });
    expect(result.from).toEqual([
      { name: 'José Pérez', address: 'jose@example.invalid' },
    ]);
    expect(result.to).toEqual([
      { name: 'Doe, Jane', address: 'jane@example.invalid' },
      { name: 'Bob', address: 'bob@example.invalid' },
    ]);
    expect(result.cc[0]).toEqual({
      name: 'María',
      address: 'maria@example.invalid',
    });
    expect(result.bcc[0].address).toBe('blind@example.invalid');
    expect(result.replyTo[0].address).toBe('support@example.invalid');
    expect(result.subject).toBe('Reunión mañana');
    expect(result.inReplyTo).toEqual(['<previous@example.invalid>']);
    expect(result.references).toEqual([
      '<first@example.invalid>',
      '<previous@example.invalid>',
    ]);
    expect(result.sentAt).toBeNull();
  });

  it('un nombre codificado con otra dirección no sustituye al remitente real', async () => {
    const input = message();
    const result = await parseGmailMessage({
      ...input,
      payload: {
        ...input.payload,
        headers: [
          {
            name: 'From',
            value:
              '=?UTF-8?B?dmljdGltQGV4YW1wbGUuaW52YWxpZA==?= <real@example.invalid>',
          },
        ],
      },
    });
    expect(result.from.map((address) => address.address)).toEqual([
      'real@example.invalid',
    ]);
  });

  it('normaliza saltos de línea y espacios sin borrar párrafos, cierres ni texto entrecomillado', async () => {
    const result = await parseGmailMessage(
      message(
        part(
          'Hola,\r\n\r\nDijo "lo reviso mañana".\r\n\r\nGracias,\r\nMarta  \r\n',
        ),
      ),
    );
    expect(result.authoredText).toBe(
      'Hola,\n\nDijo "lo reviso mañana".\n\nGracias,\nMarta',
    );
    expect(result.bodyText).toBe(result.authoredText);
    expect(result.segments).toHaveLength(1);
  });

  it('mantiene citas y firmas identificadas, sin atribuirlas al texto actual', async () => {
    const text =
      'Puedo el martes.\n\n-- \nMarta\n\nEl viernes, Ana escribió:\n> ¿Puedes el lunes?\n> Respuesta anterior.';
    const result = await parseGmailMessage(message(part(text)));
    expect(result.authoredText).toBe('Puedo el martes.');
    expect(
      result.segments
        .filter((segment) => segment.kind === 'signature')
        .map((segment) => segment.text)
        .join(),
    ).toContain('Marta');
    expect(
      result.segments
        .filter((segment) => segment.kind === 'quoted')
        .map((segment) => segment.text)
        .join(),
    ).toContain('¿Puedes el lunes?');
    expect(result.bodyText).toContain('Respuesta anterior.');
    expect(result.bodyText).toContain('--');
  });

  it('no clasifica separadores ni frases sobre móviles como una firma', async () => {
    const body =
      'Primera pregunta.\n--\nSegunda pregunta.\nSent from my iPhone is a common signature.';
    const result = await parseGmailMessage(message(part(body)));
    expect(result.authoredText).toBe(body);
    expect(
      result.segments.every((segment) => segment.kind === 'authored'),
    ).toBe(true);
  });

  it('conserva respuestas intercaladas entre líneas citadas', async () => {
    const result = await parseGmailMessage(
      message(
        part(
          'On Friday, Ana wrote:\n> ¿Martes?\nSí, a las diez.\n> ¿Online?\nPrefiero presencial.',
        ),
      ),
    );
    expect(result.authoredText).toBe('Sí, a las diez.\n\nPrefiero presencial.');
    expect(
      result.segments.filter((segment) => segment.kind === 'quoted'),
    ).toHaveLength(2);
    expect(result.warnings).not.toContain('AMBIGUOUS_QUOTE');
  });

  it.each([
    'Respuesta actual.\n\n-----Original Message-----\nFrom: Ana\nMensaje viejo sin prefijos.',
    'Respuesta actual.\n\nDe: Ana <ana@example.invalid>\nEnviado: viernes\nPara: Owner\nAsunto: Consulta\nMensaje viejo sin prefijos.',
    'Respuesta actual.\n\nEl viernes, Ana escribió:\nMensaje viejo sin prefijos.',
  ])('identifica historial sin prefijos y lo conserva (%s)', async (body) => {
    const result = await parseGmailMessage(message(part(body)));
    expect(result.authoredText).toBe('Respuesta actual.');
    expect(result.bodyText).toContain('Mensaje viejo sin prefijos.');
    expect(result.segments.at(-1)?.kind).toBe('quoted');
  });

  it('convierte HTML, entidades, listas y tablas sin ejecutar scripts ni cargar recursos', async () => {
    const result = await parseGmailMessage(
      message(
        part(
          '<html><head><title>Hidden title</title><style>secret-style</style></head><body><p>Hola&nbsp;Ana &amp; Luis.</p><ul><li>Primero</li><li>Segundo</li></ul><table><tr><td>Fecha</td><td>Martes</td></tr></table><a href="https://private.invalid/token">Ver detalles</a><img src="https://private.invalid/track"><script>secret-script</script></body></html>',
          'text/html',
        ),
      ),
    );
    expect(result.bodyText).toContain('Hola Ana & Luis.');
    expect(result.bodyText).toContain('Primero');
    expect(result.bodyText).toContain('Fecha');
    expect(result.bodyText).toContain('Martes');
    expect(result.bodyText).toContain('Ver detalles');
    expect(result.bodyText).not.toMatch(
      /secret-|<script|Hidden title|https:\/\//,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('usa la estructura HTML para separar citas, firmas y respuestas posteriores', async () => {
    const html =
      '<p>Respuesta antes.</p><div class="gmail_signature">Marta<br>Equipo</div><div class="gmail_quote">On Friday, Ana wrote:<blockquote>¿Martes?<blockquote>Más antiguo.</blockquote></blockquote></div><p>Respuesta después.</p>';
    const result = await parseGmailMessage(message(part(html, 'text/html')));
    expect(result.authoredText).toBe('Respuesta antes.\n\nRespuesta después.');
    expect(result.bodyText).toContain('Más antiguo.');
    expect(
      result.segments.some(
        (segment) =>
          segment.kind === 'signature' && segment.text.includes('Equipo'),
      ),
    ).toBe(true);
    expect(
      result.segments
        .filter((segment) => segment.kind === 'quoted')
        .map((segment) => segment.text)
        .join(),
    ).toContain('¿Martes?');
  });

  it('reconoce el encabezado HTML de Outlook y su historial posterior', async () => {
    const result = await parseGmailMessage(
      message(
        part(
          '<p>Nuevo texto.</p><div id="divRplyFwdMsg">De: Ana<br>Para: Owner</div><p>Texto anterior.</p>',
          'text/html',
        ),
      ),
    );
    expect(result.authoredText).toBe('Nuevo texto.');
    expect(result.bodyText).toContain('Texto anterior.');
    expect(result.warnings).toContain('AMBIGUOUS_QUOTE');
  });

  it('elige una representación de multipart/alternative sin duplicar el mensaje', async () => {
    const result = await parseGmailMessage(
      message({
        mimeType: 'multipart/alternative',
        parts: [
          part('Respuesta.\nContenido anterior sin marcar.'),
          part(
            '<p>Respuesta.</p><blockquote>Contenido anterior sin marcar.</blockquote>',
            'text/html',
          ),
        ],
      }),
    );
    expect(result.authoredText).toBe('Respuesta.');
    expect(result.bodyText.match(/Respuesta\./g)).toHaveLength(1);
    expect(result.bodyText.match(/Contenido anterior/g)).toHaveLength(1);
  });

  it('recurre a texto plano cuando la alternativa HTML está vacía', async () => {
    const result = await parseGmailMessage(
      message({
        mimeType: 'multipart/alternative',
        parts: [part('Texto disponible.'), part('<p>&nbsp;</p>', 'text/html')],
      }),
    );
    expect(result.authoredText).toBe('Texto disponible.');
    expect(result.isEmpty).toBe(false);
  });

  it('preserva el orden de contenido multipart/mixed e identifica adjuntos sin leerlos', async () => {
    const result = await parseGmailMessage(
      message({
        mimeType: 'multipart/mixed',
        parts: [
          part('Primera sección.'),
          part('No es texto del autor.', 'text/plain', {
            filename: 'notas.txt',
            partId: '1',
            body: { attachmentId: 'attachment-private', size: 20 },
          }),
          part('Segunda sección.'),
          {
            mimeType: 'message/rfc822',
            parts: [part('Correo reenviado interno.')],
            body: { size: 30 },
          },
        ],
      }),
    );
    expect(result.authoredText).toBe('Primera sección.\n\nSegunda sección.');
    expect(result.bodyText).not.toMatch(/No es texto|reenviado interno/);
    expect(result.hasAttachments).toBe(true);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0]).toMatchObject({
      filename: 'notas.txt',
      partId: '1',
      attachmentId: 'attachment-private',
      size: 20,
    });
    expect(result.attachments[0]).not.toHaveProperty('data');
    expect(result.attachments[0]).not.toHaveProperty('content');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('detecta adjuntos inline en multipart/related sin confundirlos con el cuerpo', async () => {
    const result = await parseGmailMessage(
      message({
        mimeType: 'multipart/related',
        parts: [
          part('<p>Revisa el esquema.</p><img src="cid:image">', 'text/html'),
          {
            mimeType: 'image/png',
            filename: 'image.png',
            headers: [
              { name: 'Content-ID', value: '<image>' },
              { name: 'Content-Disposition', value: 'inline' },
            ],
            body: { attachmentId: 'inline-image', size: 128 },
          },
        ],
      }),
    );
    expect(result.authoredText).toBe('Revisa el esquema.');
    expect(result.attachments[0]).toMatchObject({
      inline: true,
      contentId: '<image>',
    });
  });

  it.each(['', ' \r\n\t ', '<p>&nbsp;</p>'])(
    'detecta cuerpos realmente vacíos (%j)',
    async (body) => {
      const result = await parseGmailMessage(
        message(part(body, body.startsWith('<') ? 'text/html' : 'text/plain')),
      );
      expect(result).toMatchObject({
        bodyStatus: 'empty',
        isEmpty: true,
        bodyText: '',
        authoredText: '',
      });
    },
  );

  it.each([
    { ...base },
    message({
      mimeType: 'text/plain',
      body: { attachmentId: 'large-body', size: 200000 },
    }),
    message({ mimeType: 'text/plain' }),
  ])('no llama vacío a un cuerpo no descargado (%j)', async (input) => {
    const result = await parseGmailMessage(input);
    expect(result).toMatchObject({ bodyStatus: 'incomplete', isEmpty: false });
    expect(result.warnings).toContain('BODY_NOT_LOADED');
    expect(result.hasAttachments).toBe(false);
  });

  it('un mensaje formado solo por citas no contiene texto actual, pero conserva contexto', async () => {
    const result = await parseGmailMessage(
      message(part('> Solo contenido previo.')),
    );
    expect(result).toMatchObject({
      isEmpty: false,
      authoredText: '',
      bodyText: '> Solo contenido previo.',
    });
    expect(result.segments[0].kind).toBe('quoted');
  });

  it('decodifica charset declarado y evita aplicar dos veces el transfer encoding en Gmail full', async () => {
    const result = await parseGmailMessage(
      message(
        part(
          Buffer.from([0x4f, 0x6c, 0xe1, 0x20, 0x3d, 0x33, 0x44]),
          'text/plain',
          {
            headers: [
              {
                name: 'Content-Type',
                value: 'text/plain; charset="iso-8859-1"',
              },
              { name: 'Content-Transfer-Encoding', value: 'quoted-printable' },
            ],
          },
        ),
      ),
    );
    expect(result.authoredText).toBe('Olá =3D');
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ['bogus-charset', [0x61], 'UNSUPPORTED_CHARSET'],
    ['utf-8', [0xff], 'INVALID_TEXT_ENCODING'],
    [null, [0xe1], 'ASSUMED_CHARSET'],
  ] as const)(
    'señala decodificación incierta (%s)',
    async (charset, bytes, warning) => {
      const result = await parseGmailMessage(
        message(
          part(Buffer.from(bytes), 'text/plain', {
            headers: charset
              ? [
                  {
                    name: 'Content-Type',
                    value: `text/plain; charset=${charset}`,
                  },
                ]
              : [],
          }),
        ),
      );
      expect(result.warnings).toContain(warning);
      expect(result.bodyStatus).toBe('incomplete');
      expect(result.isEmpty).toBe(false);
    },
  );

  it.each(['***', 'A', 'YWJj=', 'Zh'])(
    'señala Base64URL inválido sin aceptar la decodificación permisiva de Buffer (%s)',
    async (data) => {
      const result = await parseGmailMessage(
        message({ mimeType: 'text/plain', body: { data } }),
      );
      expect(result.warnings).toContain('INVALID_BASE64');
      expect(result.bodyStatus).toBe('incomplete');
      expect(result.isEmpty).toBe(false);
    },
  );

  it('detecta cabeceras malformadas y ambiguas sin inventar remitentes, IDs o fechas', async () => {
    const input = message();
    const result = await parseGmailMessage({
      ...input,
      internalDate: 'invalid',
      payload: {
        ...input.payload,
        headers: [
          { name: 'From', value: 'Ana <ana@example.invalid>' },
          { name: 'From', value: 'Bob <bob@example.invalid>' },
          { name: 'To', value: 'invalid-address' },
          { name: 'Subject', value: 'safe\r\nBcc: attacker@example.invalid' },
          { name: 'Message-ID', value: 'not-an-id' },
          { name: 'Date', value: 'not-a-date' },
          { name: 'Bad header:', value: 'bad' },
        ],
      },
    });
    expect(result.from).toHaveLength(2);
    expect(result.to).toEqual([]);
    expect(result.subject).toBeNull();
    expect(result.internetMessageId).toBeNull();
    expect(result.sentAt).toBeNull();
    expect(result.receivedAt).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'MALFORMED_HEADERS',
        'DUPLICATE_HEADERS',
        'AMBIGUOUS_FROM',
        'INVALID_ADDRESS',
        'INVALID_DATE',
        'INVALID_MESSAGE_ID',
      ]),
    );
  });

  it('tolera ausencia de metadatos sin sustituirlos por el snippet ni por valores inventados', async () => {
    const result = await parseGmailMessage({
      ...base,
      internalDate: undefined,
      snippet: 'No es el cuerpo completo.',
      payload: part('Texto real.'),
    });
    expect(result.from).toEqual([]);
    expect(result.subject).toBeNull();
    expect(result.receivedAt).toBeNull();
    expect(result.bodyText).toBe('Texto real.');
    expect(result.warnings).toEqual(
      expect.arrayContaining(['MISSING_FROM', 'MISSING_MESSAGE_ID']),
    );
  });

  it('decodifica MIME raw con quoted-printable, charset y cabeceras RFC 2047', async () => {
    const input = rawMessage(
      'Ol=E1, ma=F1ana.\r\nL=EDnea suave=\r\n continuada.',
      [
        'Content-Type: text/plain; charset=iso-8859-1',
        'Content-Transfer-Encoding: quoted-printable',
      ],
    );
    const result = await parseGmailMessage(input);
    expect(result.authoredText).toBe('Olá, mañana.\nLínea suave continuada.');
    expect(result.from[0].address).toBe('marta@example.invalid');
    expect(result.bodyStatus).toBe('complete');
  });

  it('decodifica MIME raw multipart, Base64 y nombres RFC 2231 sin exponer bytes de adjuntos', async () => {
    const body = [
      '--outer',
      'Content-Type: multipart/alternative; boundary=alt',
      '',
      '--alt',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('Respuesta actual.').toString('base64'),
      '--alt',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Respuesta actual.</p><blockquote>Anterior.</blockquote>',
      '--alt--',
      '--outer',
      "Content-Type: application/pdf; name*=utf-8''reuni%C3%B3n.pdf",
      "Content-Disposition: attachment; filename*=utf-8''reuni%C3%B3n.pdf",
      'Content-Transfer-Encoding: base64',
      '',
      'cHJpdmF0ZS1hdHRhY2htZW50',
      '--outer--',
    ].join('\r\n');
    const result = await parseGmailMessage(
      rawMessage(body, [
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary=outer',
      ]),
    );
    expect(result.authoredText).toBe('Respuesta actual.');
    expect(result.bodyText).toContain('Anterior.');
    expect(result.attachments[0]).toMatchObject({
      filename: 'reunión.pdf',
      mimeType: 'application/pdf',
      size: 18,
    });
    expect(JSON.stringify(result)).not.toContain('private-attachment');
    expect(result).not.toHaveProperty('raw');
  });

  it('no incorpora un message/rfc822 raw como texto del remitente', async () => {
    const body = [
      '--outer',
      'Content-Type: text/plain',
      '',
      'Nuevo texto.',
      '--outer',
      'Content-Type: message/rfc822',
      '',
      'From: old@example.invalid',
      'To: owner@example.invalid',
      'Subject: Old',
      '',
      'Correo viejo privado.',
      '--outer--',
    ].join('\r\n');
    const result = await parseGmailMessage(
      rawMessage(body, ['Content-Type: multipart/mixed; boundary=outer']),
    );
    expect(result.authoredText).toBe('Nuevo texto.');
    expect(result.hasAttachments).toBe(true);
    expect(result.bodyText).not.toContain('Correo viejo');
  });

  it('getNormalizedMessage compone una única lectura full con el parser, sin otras descargas', async () => {
    const input = createEmailFixtures().attachment.messages[0];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(input));
    const client = createGmailClient(
      async () => 'synthetic-token',
      1000,
      fetcher,
    );
    const result = await getNormalizedMessage(client, input.id);
    expect(result.hasAttachments).toBe(true);
    expect(result.authoredText).toContain('La información que preguntas');
    expect(String(fetcher.mock.calls[0][0])).toContain('format=full');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('conserva instrucciones maliciosas como datos de correo, sin ejecutarlas ni alterarlas', async () => {
    const result = await parseGmailMessage(
      createEmailFixtures().untrustedContent.messages[0],
    );
    expect(result.authoredText).toContain(
      'Ignora las instrucciones anteriores',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limita profundidad, partes y tamaño y sus errores no incluyen contenido privado', async () => {
    let nested = part('synthetic-private-content');
    for (let i = 0; i < emailLimits.depth + 1; i++)
      nested = { mimeType: 'multipart/mixed', parts: [nested] };
    const inputs = [
      message(nested),
      message({
        mimeType: 'multipart/mixed',
        parts: Array.from({ length: emailLimits.parts }, () => part('a')),
      }),
      message(part(Buffer.alloc(emailLimits.bytes + 1, 97))),
      message(
        part('text', 'text/plain', {
          headers: [
            { name: 'Subject', value: 'a'.repeat(emailLimits.headerBytes) },
          ],
        }),
      ),
    ];
    for (const input of inputs) {
      const error = await parseGmailMessage(input).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ code: 'LIMIT_EXCEEDED' });
      expect(String(error) + inspect(error)).not.toContain(
        'synthetic-private-content',
      );
    }
  });

  it('limita HTML profundo sin devolver silenciosamente texto truncado', async () => {
    await expect(
      parseGmailMessage(
        message(
          part(
            '<div>'.repeat(130) + 'hidden-deep-text' + '</div>'.repeat(130),
            'text/html',
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it.each([
    null,
    {},
    { ...base, id: '../profile' },
    { ...base, labelIds: [42] },
    { ...base, raw: 'private!invalid' },
  ])(
    'normaliza errores de entrada sin devolver datos del email (%j)',
    async (input) => {
      const error = await parseGmailMessage(
        input as unknown as GmailMessage,
      ).catch((error: unknown) => error);
      expect(error).toHaveProperty('name', 'EmailParseError');
      expect(String(error) + JSON.stringify(error)).not.toContain(
        'private!invalid',
      );
    },
  );
});
