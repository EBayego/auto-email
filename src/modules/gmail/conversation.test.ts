import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type { GmailMessage, GmailThread } from '@/providers/contracts';
import { createGmailClient } from '@/providers/gmail';
import { ProviderError } from '@/providers/errors';
import { createEmailFixtures } from '../../../tests/fixtures/emails';
import {
  conversationLimits,
  getThreadContext,
  reconstructConversation,
} from './conversation';

const owner = 'owner@example.invalid';
const contact = 'contact@example.invalid';
const input = { accountId: 'account-16', mailboxAddress: owner };
const threadId = 'thread-16';
function message(
  id: string,
  minute: number,
  options: {
    from?: string;
    to?: string;
    cc?: string;
    replyTo?: string;
    inReplyTo?: string;
    references?: string;
    labels?: string[];
    text?: string;
    date?: string;
  } = {},
): GmailMessage {
  const text = options.text ?? `Texto de ${id}.`;
  return {
    id,
    threadId,
    internalDate: String(Date.UTC(2026, 9, 18, 10, minute)),
    labelIds: options.labels ?? ['INBOX'],
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: options.from ?? contact },
        { name: 'To', value: options.to ?? owner },
        { name: 'Subject', value: 'Consulta sintética' },
        { name: 'Message-ID', value: `<${id}@example.invalid>` },
        {
          name: 'Date',
          value: options.date ?? 'Sun, 18 Oct 2026 10:00:00 +0000',
        },
        ...(options.cc ? [{ name: 'Cc', value: options.cc }] : []),
        ...(options.replyTo
          ? [{ name: 'Reply-To', value: options.replyTo }]
          : []),
        ...(options.inReplyTo
          ? [
              {
                name: 'In-Reply-To',
                value: `<${options.inReplyTo}@example.invalid>`,
              },
            ]
          : []),
        ...(options.references
          ? [{ name: 'References', value: options.references }]
          : []),
      ],
      body: {
        data: Buffer.from(text).toString('base64url'),
        size: Buffer.byteLength(text),
      },
    },
  };
}
const thread = (messages: readonly GmailMessage[]): GmailThread => ({
  id: threadId,
  historyId: '123',
  messages,
});
const sent = (
  id: string,
  minute: number,
  target?: string,
  extra: Parameters<typeof message>[2] = {},
) =>
  message(id, minute, {
    from: owner,
    to: contact,
    labels: ['SENT'],
    inReplyTo: target,
    ...extra,
  });

describe('reconstrucción de conversaciones (MAIL-016)', () => {
  it('conserva para revisión un historial cuya separación de la respuesta actual es ambigua', async () => {
    const context = await reconstructConversation(
      thread([
        message('ambiguous', 1, {
          text: 'Respuesta actual.\n\nOn Friday, Ana wrote:\nTexto anterior sin prefijos.',
        }),
      ]),
      input,
    );
    expect(context.messages[0].warnings).toContain('AMBIGUOUS_QUOTE');
    expect(context.issues).toContain('AMBIGUOUS_CONTENT');
    expect(context.status).toBe('REVIEW_REQUIRED');
  });

  it('normaliza el hilo pendiente y prepara un objetivo para clasificación sin inferir su intención', async () => {
    const fixture = createEmailFixtures().pending;
    const before = structuredClone(fixture);
    const context = await reconstructConversation(fixture, input);
    expect(context).toMatchObject({
      accountId: 'account-16',
      threadId: fixture.id,
      targetMessageId: fixture.messages[0].id,
      latestIncomingMessageId: fixture.messages[0].id,
      status: 'NEEDS_CLASSIFICATION',
      hasDraft: false,
      hasManualDraft: false,
      isAlreadyAnswered: false,
      issues: [],
    });
    expect(context.messages[0]).toMatchObject({
      author: 'participant',
      direction: 'incoming',
      timestampSource: 'gmail',
    });
    expect(context.messages[0].authoredText).toContain('¿podemos reunirnos');
    expect(context.participants).toEqual(
      expect.arrayContaining([
        { name: '', address: owner, isOwner: true },
        { name: '', address: contact, isOwner: false },
      ]),
    );
    expect(fixture).toEqual(before);
    expect(context.messages[0]).not.toHaveProperty('original');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ordena todos los mensajes por internalDate aunque la API y la cabecera Date discrepen', async () => {
    const first = message('first', 1, {
      date: 'Mon, 19 Oct 2026 10:00:00 +0000',
    });
    const last = message('last', 3, {
      date: 'Sat, 17 Oct 2026 10:00:00 +0000',
    });
    const context = await reconstructConversation(
      thread([last, first, sent('middle', 2, 'first')]),
      input,
    );
    expect(context.messages.map((message) => message.id)).toEqual([
      'first',
      'middle',
      'last',
    ]);
    expect(context.targetMessageId).toBe('last');
    expect(context.status).toBe('NEEDS_CLASSIFICATION');
    expect(context.messages[0].answeredByMessageIds).toEqual(['middle']);
    expect(context.pendingMessageIds).toEqual(['last']);
  });

  it('detecta una respuesta enviada posteriormente y no considera el draft una respuesta', async () => {
    const answered = await reconstructConversation(
      createEmailFixtures().answered,
      input,
    );
    expect(answered.status).toBe('ALREADY_ANSWERED');
    expect(answered.isAlreadyAnswered).toBe(true);
    expect(answered.answeredByMessageIds).toEqual([
      createEmailFixtures().answered.messages[1].id,
    ]);
    const drafted = await reconstructConversation(
      createEmailFixtures().manualDraft,
      input,
    );
    expect(drafted.status).toBe('EXISTING_DRAFT');
    expect(drafted.hasManualDraft).toBe(true);
    expect(drafted.isAlreadyAnswered).toBe(false);
    expect(drafted.messages).toHaveLength(1);
    expect(drafted.drafts).toEqual([
      {
        id: createEmailFixtures().manualDraft.messages[1].id,
        isManaged: false,
      },
    ]);
    expect(JSON.stringify(drafted)).not.toContain('Borrador manual pendiente.');
  });

  it('un draft registrado por Auto Email también impide generar otro, sin etiquetarlo como manual', async () => {
    const fixture = createEmailFixtures().manualDraft;
    const context = await reconstructConversation(fixture, {
      ...input,
      managedDraftMessageIds: [fixture.messages[1].id],
    });
    expect(context).toMatchObject({
      hasDraft: true,
      hasManualDraft: false,
      status: 'EXISTING_DRAFT',
      isAlreadyAnswered: false,
    });
  });

  it('identifica autores y destinatarios en un grupo y no confunde la respuesta a otra persona', async () => {
    const context = await reconstructConversation(
      thread([
        message('ana', 1, {
          from: 'Ana <ana@example.invalid>',
          cc: 'bob@example.invalid',
        }),
        message('bob', 2, {
          from: 'Bob <bob@example.invalid>',
          cc: 'ana@example.invalid',
        }),
        sent('reply-ana', 3, 'ana', {
          to: 'ana@example.invalid',
          references: '<ana@example.invalid>',
        }),
      ]),
      input,
    );
    expect(
      context.messages.map((message) => [message.id, message.author]),
    ).toEqual([
      ['ana', 'participant'],
      ['bob', 'participant'],
      ['reply-ana', 'owner'],
    ]);
    expect(context.messages[0].answeredByMessageIds).toEqual(['reply-ana']);
    expect(context.messages[1].answeredByMessageIds).toEqual([]);
    expect(context.targetMessageId).toBe('bob');
    expect(context.isAlreadyAnswered).toBe(false);
    expect(context.issues).not.toContain('AMBIGUOUS_RECIPIENTS');
    expect(context.status).toBe('NEEDS_CLASSIFICATION');
    expect(
      context.participants.map((participant) => participant.address).sort(),
    ).toEqual(['ana@example.invalid', 'bob@example.invalid', owner].sort());
  });

  it('una referencia a un antepasado no equivale a haber respondido directamente a ese mensaje', async () => {
    const context = await reconstructConversation(
      thread([
        message('original', 1),
        message('followup', 2),
        sent('reply', 3, 'followup', {
          references: '<original@example.invalid> <followup@example.invalid>',
        }),
      ]),
      { ...input, targetMessageId: 'original' },
    );
    expect(context.isAlreadyAnswered).toBe(false);
    expect(context.messages[0].possiblyAnsweredByMessageIds).toEqual(['reply']);
    expect(context.messages[1].answeredByMessageIds).toEqual(['reply']);
    expect(context.status).toBe('SUPERSEDED');
  });

  it('admite References como evidencia cuando falta In-Reply-To y el último ID es el objetivo', async () => {
    const context = await reconstructConversation(
      thread([
        message('question', 1),
        sent('reply', 2, undefined, {
          references: '<older@example.invalid> <question@example.invalid>',
        }),
      ]),
      input,
    );
    expect(context.isAlreadyAnswered).toBe(true);
    expect(context.status).toBe('ALREADY_ANSWERED');
  });

  it('no confirma respuestas cuando dos mensajes comparten el Message-ID de Internet', async () => {
    const copy = message('second', 2);
    const duplicate = {
      ...copy,
      payload: {
        ...copy.payload,
        headers: copy.payload!.headers!.map((header) =>
          header.name === 'Message-ID'
            ? { ...header, value: '<first@example.invalid>' }
            : header,
        ),
      },
    };
    const context = await reconstructConversation(
      thread([message('first', 1), duplicate, sent('reply', 3, 'first')]),
      input,
    );
    expect(context.isAlreadyAnswered).toBe(false);
    expect(context.issues).toContain('DUPLICATE_MESSAGE_ID');
    expect(context.status).toBe('REVIEW_REQUIRED');
  });

  it('no confirma respuestas con cabeceras In-Reply-To duplicadas y contradictorias', async () => {
    const reply = sent('reply', 2, 'question');
    const ambiguous = {
      ...reply,
      payload: {
        ...reply.payload,
        headers: [
          ...reply.payload!.headers!,
          { name: 'In-Reply-To', value: '<unrelated@example.invalid>' },
        ],
      },
    };
    const context = await reconstructConversation(
      thread([message('question', 1), ambiguous]),
      input,
    );
    expect(context.isAlreadyAnswered).toBe(false);
    expect(context.issues).toContain('POSSIBLE_REPLY');
    expect(context.status).toBe('REVIEW_REQUIRED');
  });

  it.each([
    sent('unrelated', 2, 'another-message'),
    sent('different-person', 2, undefined, {
      to: 'someone-else@example.invalid',
    }),
    sent('earlier', 0, 'question'),
    message('other-participant', 2, {
      inReplyTo: 'question',
      from: 'other@example.invalid',
    }),
  ])(
    'no considera cualquier mensaje posterior como una respuesta del usuario (%j)',
    async (later) => {
      const context = await reconstructConversation(
        thread([message('question', 1), later]),
        { ...input, targetMessageId: 'question' },
      );
      expect(context.isAlreadyAnswered).toBe(false);
      expect(context.answeredByMessageIds).toEqual([]);
    },
  );

  it.each([
    sent('without-headers', 2),
    sent('wrong-recipient', 2, 'question', { to: 'other@example.invalid' }),
  ])(
    'señala una posible respuesta sin afirmar que ya se ha contestado (%j)',
    async (later) => {
      const context = await reconstructConversation(
        thread([message('question', 1), later]),
        input,
      );
      expect(context.isAlreadyAnswered).toBe(false);
      expect(context.issues).toContain('POSSIBLE_REPLY');
      expect(context.status).toBe('REVIEW_REQUIRED');
    },
  );

  it('una respuesta antigua no marca contestado el nuevo mensaje y no arrastra incertidumbre del objetivo anterior', async () => {
    const context = await reconstructConversation(
      thread([
        message('old', 1),
        message('old-followup', 2),
        sent('old-reply', 3, 'old-followup', {
          references: '<old@example.invalid> <old-followup@example.invalid>',
        }),
        message('new-question', 4),
      ]),
      input,
    );
    expect(context.targetMessageId).toBe('new-question');
    expect(context.status).toBe('NEEDS_CLASSIFICATION');
    expect(context.isAlreadyAnswered).toBe(false);
    expect(context.issues).not.toContain('POSSIBLE_REPLY');
  });

  it('respeta un objetivo explícito y lo marca superado cuando hay otro entrante posterior', async () => {
    const context = await reconstructConversation(
      thread([message('older', 1), message('newer', 2)]),
      { ...input, targetMessageId: 'older' },
    );
    expect(context.targetMessageId).toBe('older');
    expect(context.latestIncomingMessageId).toBe('newer');
    expect(context.status).toBe('SUPERSEDED');
  });

  it('reconoce alias proporcionados explícitamente y compara direcciones sin depender de mayúsculas', async () => {
    const context = await reconstructConversation(
      thread([
        message('question', 1, { to: 'Alias@Example.invalid' }),
        sent('answer', 2, 'question', {
          from: 'Alias <ALIAS@example.invalid>',
        }),
      ]),
      { ...input, aliases: ['alias@example.invalid'] },
    );
    expect(context.messages[1].author).toBe('owner');
    expect(context.isAlreadyAnswered).toBe(true);
    expect(context.issues).not.toContain('UNVERIFIED_ALIAS');
  });

  it('no confía en un From recibido que aparenta ser del titular, ni aprende alias de él', async () => {
    const context = await reconstructConversation(
      thread([message('spoofed', 1, { from: owner })]),
      input,
    );
    expect(context.messages[0]).toMatchObject({
      author: 'unknown',
      direction: 'unknown',
    });
    expect(context.issues).toContain('UNKNOWN_AUTHOR');
    expect(context.status).toBe('REVIEW_REQUIRED');
    const alias = await reconstructConversation(
      thread([
        message('unverified', 1, { from: 'owner+other@example.invalid' }),
      ]),
      input,
    );
    expect(alias.messages[0].author).toBe('participant');
  });

  it('SENT identifica un envío con un alias no configurado, pero deja constancia de la identidad pendiente', async () => {
    const context = await reconstructConversation(
      thread([
        sent('alias', 1, undefined, { from: 'alias@example.invalid' }),
        message('question', 2),
      ]),
      input,
    );
    expect(context.messages[0]).toMatchObject({
      author: 'owner',
      direction: 'outgoing',
    });
    expect(context.issues).toContain('UNVERIFIED_ALIAS');
    expect(context.status).toBe('REVIEW_REQUIRED');
  });

  it('los envíos a uno mismo no son entrantes; una copia al titular no oculta una respuesta a un tercero', async () => {
    const self = await reconstructConversation(
      thread([
        sent('self', 1, undefined, { to: owner, labels: ['SENT', 'INBOX'] }),
      ]),
      input,
    );
    expect(self.messages[0].direction).toBe('self');
    expect(self.targetMessageId).toBeNull();
    expect(self.status).toBe('NO_CANDIDATE');
    const reply = await reconstructConversation(
      thread([
        message('question', 1),
        sent('reply', 2, 'question', {
          to: `${owner}, ${contact}`,
          labels: ['SENT', 'INBOX'],
        }),
      ]),
      input,
    );
    expect(reply.messages[1].direction).toBe('outgoing');
    expect(reply.isAlreadyAnswered).toBe(true);
  });

  it('usa Date como alternativa para ordenar, pero no confirma respuestas con cronología no fiable', async () => {
    const question = { ...message('question', 1), internalDate: undefined };
    const context = await reconstructConversation(
      thread([sent('reply', 2, 'question'), question]),
      input,
    );
    expect(context.messages.map((message) => message.id)).toEqual([
      'question',
      'reply',
    ]);
    expect(context.messages[0].timestampSource).toBe('header');
    expect(context.isAlreadyAnswered).toBe(false);
    expect(context.issues).toContain('UNTRUSTED_CHRONOLOGY');
    expect(context.status).toBe('REVIEW_REQUIRED');
  });

  it('no decide una respuesta posterior por el orden arbitrario de dos marcas de tiempo iguales', async () => {
    const context = await reconstructConversation(
      thread([sent('answer', 1, 'question'), message('question', 1)]),
      input,
    );
    expect(context.isAlreadyAnswered).toBe(false);
    expect(context.issues).toContain('AMBIGUOUS_CHRONOLOGY');
    expect(context.status).toBe('REVIEW_REQUIRED');
  });

  it('excluye spam y papelera del texto contextual y no responde automáticamente al resto incompleto', async () => {
    const context = await reconstructConversation(
      thread([
        message('question', 1),
        message('spam', 2, { text: 'spam-private-body', labels: ['SPAM'] }),
        sent('deleted-reply', 3, 'question', {
          labels: ['SENT', 'TRASH'],
          text: 'deleted-private-body',
        }),
      ]),
      input,
    );
    expect(context.messages).toHaveLength(1);
    expect(context.excludedMessageIds).toEqual(['spam', 'deleted-reply']);
    expect(context.status).toBe('REVIEW_REQUIRED');
    expect(JSON.stringify(context)).not.toMatch(
      /spam-private-body|deleted-private-body/,
    );
  });

  it.each([
    message('empty', 1, { text: '' }),
    message('quoted-only', 1, { text: '> Previous message.' }),
    {
      ...message('missing-body', 1),
      payload: {
        ...message('missing-body', 1).payload,
        body: { attachmentId: 'body', size: 40 },
      },
    },
    message('reply-to-other', 1, { replyTo: 'different@example.invalid' }),
  ])(
    'mantiene para revisión los objetivos vacíos, incompletos o ambiguos (%j)',
    async (target) => {
      const context = await reconstructConversation(thread([target]), input);
      expect(context.targetMessageId).toBe(target.id);
      expect(context.status).toBe('REVIEW_REQUIRED');
    },
  );

  it('conserva los límites de voz del parser, sin incorporar las citas al texto actual', async () => {
    const context = await reconstructConversation(
      thread([
        message('question', 1, {
          text: 'Pregunta nueva.\n\nOn Friday, Owner wrote:\n> Texto anterior del propietario.',
        }),
      ]),
      input,
    );
    expect(context.messages[0].author).toBe('participant');
    expect(context.messages[0].authoredText).toBe('Pregunta nueva.');
    expect(context.messages[0].segments.at(-1)?.kind).toBe('quoted');
    expect(context.messages[0].bodyText).toContain(
      'Texto anterior del propietario.',
    );
  });

  it('no selecciona correos archivados o propios como objetivos automáticos', async () => {
    const archived = await reconstructConversation(
      thread([message('archived', 1, { labels: [] })]),
      input,
    );
    expect(archived.status).toBe('NO_CANDIDATE');
    expect(archived.targetMessageId).toBeNull();
    const own = await reconstructConversation(thread([sent('own', 1)]), {
      ...input,
      targetMessageId: 'own',
    });
    expect(own.status).toBe('NO_CANDIDATE');
    expect(own.issues).toContain('TARGET_NOT_INCOMING');
  });

  it('normaliza un hilo vacío y falla si desaparece el objetivo explícito', async () => {
    const context = await reconstructConversation(thread([]), input);
    expect(context).toMatchObject({
      messages: [],
      participants: [],
      status: 'NO_CANDIDATE',
      targetMessageId: null,
    });
    await expect(
      reconstructConversation(thread([]), {
        ...input,
        targetMessageId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
  });

  it('recupera un hilo completo con una sola consulta a users/me/threads y propaga los errores del proveedor', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(thread([message('question', 1)])));
    const client = createGmailClient(
      async () => 'private-unit-token',
      1000,
      fetcher,
    );
    const context = await getThreadContext(client, { ...input, threadId });
    expect(context.status).toBe('NEEDS_CLASSIFICATION');
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    );
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValue(
      Response.json(
        { error: { message: 'private-unit-token' } },
        { status: 429 },
      ),
    );
    await expect(
      getThreadContext(client, { ...input, threadId }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client).not.toHaveProperty('send');
  });

  it('rechaza contextos cruzados, duplicados y demasiado grandes sin truncarlos ni exponer contenido', async () => {
    for (const invalid of [
      thread([message('same', 1), message('same', 2)]),
      thread([{ ...message('other-thread', 1), threadId: 'different' }]),
      thread(
        Array.from({ length: conversationLimits.messages + 1 }, (_, index) =>
          message(`m${index}`, index),
        ),
      ),
      thread([
        {
          ...message('too-big', 1),
          raw: 'x'.repeat(conversationLimits.bytes + 1),
        },
      ]),
    ]) {
      const error = await reconstructConversation(invalid, input).catch(
        (error: unknown) => error,
      );
      expect(error).toHaveProperty('name', 'ConversationError');
      expect(String(error) + inspect(error)).not.toContain('Texto de');
    }
    const broken = {
      ...message('broken', 1),
      payload: {
        ...message('broken', 1).payload,
        headers: [{ name: 'Subject', value: 'private-body'.repeat(30000) }],
      },
    };
    await expect(
      reconstructConversation(thread([broken]), input),
    ).rejects.toMatchObject({ code: 'MESSAGE_PARSE_FAILED' });
  });

  it('mantiene hilos de más de 20 mensajes completos sin descartar el inicio', async () => {
    const context = await reconstructConversation(
      thread(
        Array.from({ length: 25 }, (_, index) => message(`m${index}`, index)),
      ),
      input,
    );
    expect(context.messages).toHaveLength(25);
    expect(context.messages[0].id).toBe('m0');
    expect(context.targetMessageId).toBe('m24');
    expect(context.status).toBe('NEEDS_CLASSIFICATION');
  });

  it.each([
    { mailboxAddress: 'not-email' },
    { accountId: '../other' },
    { aliases: ['invalid'] },
    { targetMessageId: '../profile' },
  ])('valida la identidad antes de tocar Gmail (%j)', async (invalid) => {
    const getThread = vi.fn();
    await expect(
      getThreadContext({ getThread }, { ...input, threadId, ...invalid }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(getThread).not.toHaveBeenCalled();
  });
});
