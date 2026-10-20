import { describe, expect, it } from 'vitest';
import { parseGmailMessage } from '@/modules/gmail/parser';
import { sentEmail, withHeaders } from '../../../tests/fixtures/sent-emails';
import { EmailStylePreprocessor } from './email-style-preprocessor';

const preprocessor = new EmailStylePreprocessor();
const own =
  'Hola Ana, he revisado tu propuesta y podemos comenzar el próximo lunes.';
const legal =
  'Este mensaje contiene información confidencial y está dirigido exclusivamente a su destinatario. Si lo ha recibido por error, elimínelo y avise al remitente.';
async function clean(text: string, html = false) {
  const raw = sentEmail(0, {}, text);
  const message = html
    ? { ...raw, payload: { ...raw.payload, mimeType: 'text/html' } }
    : raw;
  return preprocessor.preprocess(await parseGmailMessage(message));
}

describe('MAIL-023, EmailStylePreprocessor', () => {
  it.each([
    legal,
    'AVISO LEGAL:\n' + legal,
    'This email contains confidential and privileged information intended only for the addressee. If you have received this message in error, please delete it.',
    'La información contenida en este correo es confidencial. Queda prohibida su distribución a quien no sea el destinatario.',
  ])(
    'separa avisos legales completos y conserva el cierre (%s)',
    async (notice) => {
      const result = await clean(`${own}\n\nUn saludo,\nEdu\n\n${notice}`);
      expect(result.authoredText).toBe(`${own}\n\nUn saludo,\nEdu`);
      expect(
        result.segments
          .filter((s) => s.kind === 'legal')
          .map((s) => s.text)
          .join(),
      ).toContain(notice);
      expect(result.exclusion).toBeNull();
    },
  );

  it('elimina continuaciones legales pero conserva una posdata escrita después', async () => {
    const result = await clean(
      `${own}\n\n${legal}\n\nSi usted no es el destinatario, queda prohibida cualquier copia.\n\nPD: El martes te envío el resto del material.`,
    );
    expect(result.authoredText).toBe(
      `${own}\n\nPD: El martes te envío el resto del material.`,
    );
  });

  it('elimina encabezados legales aislados y mantiene frases personales después del aviso', async () => {
    const personal =
      'Si usted puede confirmarme el horario, preparo la reunión.';
    const result = await clean(
      `${own}\n\nAVISO LEGAL\n\n${legal}\n\n${personal}`,
    );
    expect(result.authoredText).toBe(`${own}\n\n${personal}`);
  });

  it.each([
    'Sent from my iPhone',
    'Enviado desde mi Android.',
    'Enviado desde Outlook para Android',
    'Get Outlook for iOS',
    'Please consider the environment before printing this email.',
  ])('elimina firmas de cliente sin separador (%s)', async (signature) => {
    const result = await clean(`${own}\n\nGracias,\nEdu\n${signature}`);
    expect(result.authoredText).toBe(`${own}\n\nGracias,\nEdu`);
    expect(
      result.segments.some(
        (s) => s.kind === 'signature' && s.text === signature,
      ),
    ).toBe(true);
  });

  it('elimina un bloque de firma con varios datos de contacto y mantiene la despedida', async () => {
    const result = await clean(
      `${own}\n\nUn saludo,\nEdu Pérez\nEquipo Comercial\nTel: +34 600 123 456\nCorreo: edu@example.invalid\nhttps://example.invalid`,
    );
    expect(result.authoredText).toBe(`${own}\n\nUn saludo,`);
    expect(
      result.segments
        .filter((s) => s.kind === 'signature')
        .map((s) => s.text)
        .join(),
    ).toContain('Edu Pérez');
  });

  it.each([
    'Gracias,\nEdu',
    'Un abrazo,\nEdu',
    'La cláusula de confidencialidad se aplica al destinatario del contrato.',
    'Este mensaje explica el cambio de destinatario, no contiene información confidencial.',
    'Sent from my iPhone is a common automatic signature.',
    'Para cancelar tu suscripción puedes escribirnos y lo reviso personalmente.',
    'De: diseño\nPara: desarrollo\nTenemos que revisar las pruebas.',
    'Begin forwarded message: es el texto que muestra mi móvil.',
    'Primera parte.\n--\nSegunda parte.',
    'Puedes llamarme mañana\nTel: +34 600 123 456\nhttps://example.invalid',
  ])(
    'conserva texto personal que se parece a un marcador (%s)',
    async (personal) => {
      const result = await clean(`${own}\n\n${personal}`);
      // Contact details can be omitted, but the personal sentence must survive.
      const expected = personal.startsWith('Puedes')
        ? 'Puedes llamarme mañana'
        : personal;
      expect(result.authoredText).toContain(expected);
      expect(result.hasForwardedContent).toBe(false);
      expect(result.exclusion).toBeNull();
    },
  );

  it('conserva respuestas intercaladas y separa citas anidadas y firmas HTML', async () => {
    const result = await clean(
      `<p>${own}</p><blockquote>¿Online?<blockquote>Texto más antiguo.</blockquote></blockquote><p>Prefiero presencial.</p><div class="gmail_signature">Firma de empresa</div><p>${legal}</p>`,
      true,
    );
    expect(result.authoredText).toBe(`${own}\n\nPrefiero presencial.`);
    expect(result.inheritedText).toContain('Texto más antiguo.');
    expect(result.segments.some((s) => s.kind === 'signature')).toBe(true);
  });

  it('preserva respuestas inline entre líneas con prefijo de cita', async () => {
    const result = await clean(
      'On Friday, Ana wrote:\n> ¿Martes?\nSí, a las diez.\n> ¿Online?\nPrefiero presencial.',
    );
    expect(result.authoredText).toBe('Sí, a las diez.\n\nPrefiero presencial.');
    expect(result.inheritedText).toContain('¿Online?');
  });

  it.each([
    '---------- Forwarded message ---------\nFrom: Other\nTexto heredado.',
    'Begin forwarded message:\nFrom: Other\nTexto heredado.',
    'Inicio del mensaje reenviado:\nDe: Other\nTexto heredado.',
    '---------- Mensagem encaminhada ---------\nDe: Other\nTexto heredado.',
    'Von: Other\nGesendet: Freitag\nAn: Owner\nBetreff: Projekt\nTexto heredado.',
    'Em 16 de outubro de 2026, Ana <ana@example.invalid> escreveu:\nTexto heredado.',
    'Il 16 ottobre 2026,\nAna <ana@example.invalid> ha scritto:\nTexto heredado.',
    '-----Original Message-----\nFrom: Other\nTexto heredado.',
  ])('separa cabeceras y cadenas heredadas (%s)', async (history) => {
    const result = await clean(`${own}\n\n${history}`);
    expect(result.authoredText).toBe(own);
    expect(result.inheritedText).toContain('Texto heredado.');
  });

  it.each([
    'Este mensaje se ha generado automáticamente. No responda a este correo.',
    'This is an automatically generated message. Please do not reply to this email.',
    'Oferta semanal con las novedades.\n\nRecibes este correo porque te has suscrito a nuestra lista. Puedes darte de baja aquí.',
    'Weekly offers and news.\n\nYou are receiving this email because you signed up. Unsubscribe here.',
  ])(
    'excluye sistemas externos y campañas detectables sin cabeceras (%s)',
    async (body) => {
      expect((await clean(body)).exclusion).toBe('AUTOMATED');
    },
  );

  it('no atribuye al usuario las señales automáticas de texto citado', async () => {
    const result = await clean(
      `${own}\n\n> Este mensaje se ha generado automáticamente. No responda a este correo.\n> Recibes este correo porque te has suscrito. Puedes darte de baja aquí.`,
    );
    expect(result.authoredText).toBe(own);
    expect(result.exclusion).toBeNull();
  });

  it('usa cabeceras explícitas y no clasifica un cliente de correo normal como sistema', async () => {
    const cases: Record<string, string>[] = [
      { 'List-Id': 'campaign' },
      { 'Auto-Submitted': 'auto-generated' },
      { Precedence: 'bulk' },
    ];
    for (const headers of cases) {
      const raw = withHeaders(sentEmail(0), headers);
      expect(
        preprocessor.preprocess(
          await parseGmailMessage(raw),
          raw.payload?.headers,
        ).exclusion,
      ).toBe('AUTOMATED');
    }
    const raw = withHeaders(sentEmail(0), {
      'Auto-Submitted': 'no',
      'X-Mailer': 'Outlook',
    });
    expect(
      preprocessor.preprocess(
        await parseGmailMessage(raw),
        raw.payload?.headers,
      ).exclusion,
    ).toBeNull();
  });

  it('no modifica mensajes ni aprende estado entre llamadas o cuentas', async () => {
    const email = await parseGmailMessage(
      sentEmail(0, {}, `${own}\n\n${legal}`),
    );
    const before = structuredClone(email);
    const first = preprocessor.preprocess(email);
    expect(preprocessor.preprocess(email)).toEqual(first);
    expect(email).toEqual(before);
    expect(
      (await clean('Gracias por tu ayuda, lo revisamos mañana.')).authoredText,
    ).toBe('Gracias por tu ayuda, lo revisamos mañana.');
  });
});
