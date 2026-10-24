import PostalMime from 'postal-mime';
import { describe, expect, it, vi } from 'vitest';
import { buildGmailMime, plainTextToHtml, gmailMimeLimits } from './mime';
import { buildReplyMime } from './reply-mime';
import {
  selectReplyRecipients,
  replyRecipientAddresses,
} from './reply-recipients';
import { selectPendingEmail } from './manual-selection';
import { createReplyDraftForThread } from '@/poc/create-reply-draft';
import { draftFixture } from '../../../tests/fixtures/drafts';
import { parseGeneratedResponse } from '@/modules/response/schema';
import { readyResponse } from '../../../tests/fixtures/responses';

const address = (value: string, name = '') => ({ address: value, name });
function routingFixture() {
  const f = draftFixture();
  const thread = {
    ...f.thread,
    messages: f.thread.messages.map((message) => ({
      ...message,
      payload: {
        ...message.payload,
        headers: [...(message.payload?.headers ?? [])],
      },
    })),
  };
  f.gmail.getThread.mockResolvedValue(thread);
  return { ...f, thread };
}
const owner = 'owner@example.invalid',
  sender = 'contact@example.invalid',
  colleague = 'colleague@example.invalid';
const fixture = () => ({
  from: address(owner, 'Éduard 📨'),
  to: [address(sender, 'Pérez, Ana')],
  subject: 'Re: Confirmación',
  bodyText: 'Hola,\n\nGracias y un saludo.',
  internetMessageId: '<mail047@example.invalid>',
  inReplyTo: '<question@example.invalid>',
  references: ['<ancestor@example.invalid>', '<question@example.invalid>'],
  now: new Date('2026-10-24T14:00:00Z'),
});
describe('MAIL-047 mensajes MIME definitivos para Gmail', () => {
  it.each([
    [
      'es',
      'Confirmación: ¿mañana? 📩',
      'Buenos días,\n\n• Primera opción: acción y ñ.\n• Segunda opción: 125 €.\n\nUn saludo.',
    ],
    [
      'fr',
      'Réception et prochaines étapes',
      'Bonjour,\n\n- Été, cœur et Noël.\n- Merci pour votre message.\n\nÀ bientôt.',
    ],
    [
      'ja',
      'お問い合わせへの返信',
      'こんにちは。\n\n・お問い合わせを受け取りました。\n・ありがとうございます。',
    ],
    ['ar', 'رد على الرسالة', 'مرحبًا،\n\n• شكرًا على رسالتك.\n• إلى اللقاء.'],
    [
      'fa',
      'پاسخ به پیام',
      'سلام،\n\nپیام شما را دریافت کردم.\nمی\u200cتوانیم گفتگو کنیم.',
    ],
    [
      'emoji',
      'Familia 👨‍👩‍👧‍👦 y café ☕',
      'Hola 👩🏽‍💻,\n\nGracias por tu mensaje 👨‍👩‍👧‍👦.\n\n¡Hasta pronto!',
    ],
    [
      'spacing',
      'Espacios y listas',
      '  Texto indentado\r\n\r\n\r\n\t- Uno  \r\n\t- Dos\r\n',
    ],
  ])(
    'conserva asunto, UTF-8 y saltos en %s',
    async (_language, subject, bodyText) => {
      const mime = buildGmailMime({ ...fixture(), subject, bodyText });
      const bytes = Buffer.from(mime.raw, 'base64url'),
        parsed = await PostalMime.parse(bytes);
      expect(parsed.subject).toBe(subject);
      expect(parsed.text?.replace(/\r\n/gu, '\n')).toBe(
        bodyText.replace(/\r\n?/gu, '\n'),
      );
      expect(parsed.from).toEqual(fixture().from);
      expect(parsed.to).toEqual(fixture().to);
      expect(parsed.inReplyTo).toBe(fixture().inReplyTo);
      expect(parsed.references).toBe(fixture().references.join(' '));
      expect(parsed.bcc).toBeUndefined();
      expect(parsed.attachments).toEqual([]);
      expect(mime.raw).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(bytes.toString('ascii').replace(/\r\n/gu, '')).not.toMatch(
        /[\r\n]/u,
      );
      expect(
        bytes
          .toString()
          .split('\r\n')
          .every((line) => Buffer.byteLength(line) <= 998),
      ).toBe(true);
      expect(bytes.every((byte) => byte < 128)).toBe(true);
    },
  );
  it('admite HTML sencillo derivado del texto, escapando etiquetas, enlaces y atributos', async () => {
    const bodyText =
      'Hola <script>alert("x")</script> & <img src="https://tracker.invalid/pixel">\n\n• Opción <segura>\n• Otra opción';
    const mime = buildGmailMime({
      ...fixture(),
      bodyText,
      format: 'alternative',
    });
    const parsed = await PostalMime.parse(Buffer.from(mime.raw, 'base64url'));
    expect(parsed.text?.replace(/\r\n/gu, '\n')).toBe(bodyText);
    expect(parsed.html).toContain('&lt;script&gt;');
    expect(parsed.html).toContain('&amp;');
    expect(parsed.html).not.toMatch(/<script|<img|<a\s|<iframe|<form/iu);
    expect(parsed.attachments).toEqual([]);
    expect(parsed.html?.replace(/\r\n/gu, '\n')).toBe(
      plainTextToHtml(bodyText),
    );
    expect(Buffer.from(mime.raw, 'base64url').toString()).toContain(
      'multipart/alternative',
    );
    expect(
      Buffer.from(mime.raw, 'base64url')
        .toString()
        .match(/boundary="([^"]+)"/u)?.[1].length,
    ).toBeLessThanOrEqual(70);
  });
  it('plega nombres y asunto largos sin separar caracteres UTF-8', async () => {
    const input = {
      ...fixture(),
      subject: '返信 📩 e\u0301'.repeat(160),
      to: [address(sender, 'Álvaro, 👨‍👩‍👧‍👦'.repeat(9))],
    };
    const raw = Buffer.from(buildGmailMime(input).raw, 'base64url');
    const parsed = await PostalMime.parse(raw);
    expect(parsed.subject).toBe(input.subject);
    expect(parsed.to).toEqual(input.to);
    for (const word of raw.toString().match(/=\?UTF-8\?B\?[^?]+\?=/gu) ?? [])
      expect(Buffer.byteLength(word)).toBeLessThanOrEqual(75);
    expect(
      raw
        .toString()
        .split('\r\n')
        .every((line) => Buffer.byteLength(line) <= 998),
    ).toBe(true);
  });
  it('deduplica Para/Cc sin cambiar la cabecera de origen ni incorporar Bcc', async () => {
    const mime = buildGmailMime({
      ...fixture(),
      to: [address(sender), address(sender.toUpperCase())],
      cc: [
        address(sender),
        address(colleague),
        address(colleague.toUpperCase()),
      ],
      bcc: [address('hidden@example.invalid')],
    } as Parameters<typeof buildGmailMime>[0]);
    const parsed = await PostalMime.parse(Buffer.from(mime.raw, 'base64url'));
    expect(parsed.to).toEqual([address(sender)]);
    expect(parsed.cc).toEqual([address(colleague)]);
    expect(parsed.bcc).toBeUndefined();
    expect(Buffer.from(mime.raw, 'base64url').toString()).not.toContain(
      'hidden@example.invalid',
    );
  });
  it.each([
    { to: [address('bad@example.invalid\r\nBcc: victim@example.invalid')] },
    { to: [address('a@example.invalid,b@example.invalid')] },
    { cc: [address('a@example..invalid')] },
    { from: address(owner, 'Nombre\r\nBcc: victim@example.invalid') },
    { subject: 'Asunto\nBcc: victim@example.invalid' },
    { bodyText: 'Hola\u0000' },
    { bodyText: 'Texto\u202eoculto' },
    { bodyText: 'Surrogado\ud800' },
    { subject: 'Surrogado\udfff' },
    {
      to: Array.from({ length: gmailMimeLimits.recipients + 1 }, (_, i) =>
        address(`member${i}@example.invalid`),
      ),
    },
  ])('rechaza una entrada insegura: %j', (change) =>
    expect(() => buildGmailMime({ ...fixture(), ...change })).toThrow(
      'INVALID_INPUT',
    ),
  );
  it('el contrato del generador admite uniones Unicode legítimas sin admitir controles bidi', () => {
    expect(
      parseGeneratedResponse(
        JSON.stringify({ ...readyResponse(), bodyText: 'Hola 👨‍👩‍👧‍👦. Un saludo.' }),
      ).status,
    ).toBe('READY');
    expect(() =>
      parseGeneratedResponse(
        JSON.stringify({
          ...readyResponse(),
          bodyText: 'Texto \u202emalicioso',
        }),
      ),
    ).toThrow('INVALID_RESPONSE');
  });
});

describe('MAIL-047 destinatarios visibles y privados', () => {
  const target = () => ({
    from: [address(sender, 'Ana')],
    to: [address(owner), address(colleague)],
    cc: [address('copy@example.invalid')],
    bcc: [address('hidden@example.invalid')],
    replyTo: [] as ReturnType<typeof address>[],
  });
  it('responde al remitente y conserva la distinción Para/Cc, excluyendo cuenta, alias y duplicados', () => {
    const value = target();
    value.to.push(address('ALIAS@example.invalid'), address(sender));
    value.cc.push(address(colleague.toUpperCase()), address(owner));
    const recipients = selectReplyRecipients(value, {
      mailboxAddress: owner,
      aliases: ['alias@example.invalid'],
    })!;
    expect(recipients).toEqual({
      to: address(sender, 'Ana'),
      additionalTo: [address(colleague)],
      cc: [address('copy@example.invalid')],
    });
    expect(replyRecipientAddresses(recipients)).toEqual([
      sender,
      colleague,
      'copy@example.invalid',
    ]);
  });
  it('un destinatario en copia oculta responde solo al remitente', () => {
    const value = target();
    value.to = [address(colleague)];
    value.bcc.push(address(owner));
    expect(selectReplyRecipients(value, { mailboxAddress: owner })).toEqual({
      to: address(sender, 'Ana'),
    });
  });
  it.each([
    'delegated',
    'multipleFrom',
    'multipleReplyTo',
    'noOwner',
    'invalidCopy',
    'tooMany',
  ] as const)('mantiene para revisión una ruta ambigua: %s', (change) => {
    const value = target();
    if (change === 'delegated')
      value.replyTo.push(address('other@example.invalid'));
    if (change === 'multipleFrom')
      value.from.push(address('other@example.invalid'));
    if (change === 'multipleReplyTo')
      value.replyTo.push(address(sender), address('other@example.invalid'));
    if (change === 'noOwner') value.to = [address(colleague)];
    if (change === 'invalidCopy') value.cc = [address('a@example..invalid')];
    if (change === 'tooMany')
      value.cc = Array.from({ length: 50 }, (_, i) =>
        address(`member${i}@example.invalid`),
      );
    expect(selectReplyRecipients(value, { mailboxAddress: owner })).toBeNull();
  });
  it('prepara y crea una respuesta al grupo conservando el hilo y excluyendo Bcc', async () => {
    const f = routingFixture();
    f.thread.messages[0].payload!.headers!.push(
      { name: 'To', value: `${owner}, ${colleague}, ALIAS@example.invalid` },
      { name: 'Cc', value: `copy@example.invalid, ${colleague.toUpperCase()}` },
      { name: 'Bcc', value: 'hidden@example.invalid' },
    );
    const input = {
      ...f,
      selection: { ...f.selection, aliases: ['alias@example.invalid'] },
      styleExamplesLimit: 0,
    };
    const report = await createReplyDraftForThread(input);
    expect(report.selection.status).toBe('SELECTED');
    expect(report.draft?.status).toBe('CREATED');
    const request = f.gmail.createDraft.mock.calls[0][0];
    const parsed = await PostalMime.parse(
      Buffer.from(request.raw, 'base64url'),
    );
    expect(parsed.to?.map((a) => ('address' in a ? a.address : null))).toEqual([
      sender,
      colleague,
    ]);
    expect(parsed.cc).toEqual([address('copy@example.invalid')]);
    expect(parsed.bcc).toBeUndefined();
    expect(request.threadId).toBe(f.thread.id);
    for (const [call] of f.text.generate.mock.calls) {
      expect(call.input).not.toContain(colleague);
      expect(call.input).not.toContain('hidden@example.invalid');
    }
  });
  it('si cambia Cc mientras se obtiene permiso, cancela antes de escribir', async () => {
    const f = routingFixture();
    f.thread.messages[0].payload!.headers!.push({
      name: 'Cc',
      value: colleague,
    });
    const reserve = f.store.reserve.getMockImplementation()!;
    f.store.reserve.mockImplementation(async (input) => {
      f.thread.messages[0].payload!.headers!.push({
        name: 'Cc',
        value: 'new@example.invalid',
      });
      return reserve(input);
    });
    const report = await createReplyDraftForThread({
      ...f,
      styleExamplesLimit: 0,
    });
    expect(report.draft).toMatchObject({
      status: 'CANCELLED',
      reason: 'THREAD_CHANGED',
    });
    expect(f.store.created).not.toHaveBeenCalled();
  });
  it('el lector conserva audiencias fuera del contexto del modelo', async () => {
    const f = routingFixture(),
      consume = vi.fn();
    f.thread.messages[0].payload!.headers!.push({
      name: 'Cc',
      value: colleague,
    });
    await selectPendingEmail(f.gmail, f.selection, consume);
    const context = consume.mock.calls[0][0];
    expect(context.messageAudiences).toEqual([[sender, owner, colleague]]);
    expect(JSON.stringify(context.modelInput)).not.toContain(colleague);
    const mime = buildReplyMime({
      from: owner,
      target: context.replyTarget,
      bodyText: readyResponse().bodyText!,
      attemptId: '00000000-0000-4000-8000-000000000047',
    });
    expect(mime.cc).toEqual([address(colleague)]);
  });
});
