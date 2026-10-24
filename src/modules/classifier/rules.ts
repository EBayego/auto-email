import { domainToASCII } from 'node:url';
import {
  normalizeEmailHeaders,
  readEmailHeaders,
} from '@/modules/gmail/email-headers';
import type { GmailMessage } from '@/providers/contracts';
import {
  classifierLimits,
  EmailClassificationError,
  type ClassifierExclusions,
  type ResolvedClassifierExclusions,
  type ClassificationReason,
  type EmailClassification,
} from './contracts';

export function normalizeClassifierDomain(input: string): string {
  if (
    typeof input !== 'string' ||
    !input ||
    input !== input.trim() ||
    /[\s/@:*<>\p{Cc}]/u.test(input)
  )
    throw new EmailClassificationError('INVALID_INPUT');
  const domain = domainToASCII(input).toLowerCase();
  if (
    !domain ||
    domain.length > 253 ||
    !domain
      .split('.')
      .every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))
  )
    throw new EmailClassificationError('INVALID_INPUT');
  return domain;
}
export function normalizeClassifierAddress(input: string): string {
  if (
    typeof input !== 'string' ||
    input.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[^\s<>@]+$/u.test(input)
  )
    throw new EmailClassificationError('INVALID_INPUT');
  const at = input.lastIndexOf('@');
  const address = `${input.slice(0, at).toLowerCase()}@${normalizeClassifierDomain(input.slice(at + 1))}`;
  if (address.length > 254) throw new EmailClassificationError('INVALID_INPUT');
  return address;
}
export function normalizeClassifierExclusions(
  input: ClassifierExclusions = {},
): ResolvedClassifierExclusions {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !['excludedAddresses', 'excludedDomains'].includes(key),
    )
  )
    throw new EmailClassificationError('INVALID_INPUT');
  const normalize = (
    items: readonly string[] | undefined,
    fn: (value: string) => string,
  ) => {
    if (items === undefined) return [];
    if (!Array.isArray(items) || items.length > classifierLimits.exclusions)
      throw new EmailClassificationError('INVALID_INPUT');
    return Object.freeze([...new Set(items.map(fn))].sort());
  };
  return Object.freeze({
    excludedAddresses: normalize(
      input.excludedAddresses,
      normalizeClassifierAddress,
    ),
    excludedDomains: normalize(
      input.excludedDomains,
      normalizeClassifierDomain,
    ),
  });
}

const explanations: Record<ClassificationReason, string> = {
  SPAM: 'El mensaje está marcado como spam.',
  TRASH: 'El mensaje está en la papelera.',
  NOT_INCOMING: 'El mensaje pertenece al titular o es un enviado o borrador.',
  EXCLUDED_SENDER:
    'El remitente está excluido por la configuración del usuario.',
  EXCLUDED_DOMAIN:
    'El dominio del remitente está excluido por la configuración del usuario.',
  NEWSLETTER: 'Los metadatos identifican una lista o envío masivo.',
  AUTOREPLY: 'El mensaje es una respuesta automática.',
  AUTO_GENERATED: 'El mensaje es una notificación generada automáticamente.',
  NO_REPLY_ADDRESS:
    'La dirección no admite respuestas y no hay un destinatario alternativo válido.',
  AMBIGUOUS_HEADERS:
    'Las cabeceras no permiten identificar un remitente o destinatario de respuesta inequívoco.',
  AMBIGUOUS_RECIPIENTS:
    'Los destinatarios requieren revisión antes de responder.',
  INVALID_MESSAGE: 'No se pudo interpretar el mensaje con seguridad.',
  MESSAGE_CHANGED:
    'La lectura del contenido no coincide con el mensaje seleccionado.',
  INCOMPLETE_CONTENT: 'No se dispone del contenido completo.',
  EMPTY_CONTENT: 'No hay texto propio suficiente para determinar la intención.',
  CONTENT_LIMIT_EXCEEDED: 'El contenido excede el límite de clasificación.',
  MODEL_UNAVAILABLE: 'El modelo no pudo completar la clasificación.',
  INVALID_MODEL_RESPONSE:
    'La salida del modelo no cumple el contrato de clasificación.',
  LOW_CONFIDENCE:
    'El modelo no dispone de suficiente certeza sobre la intención.',
  EXPLICIT_QUESTION: 'El mensaje contiene una pregunta dirigida al titular.',
  ACTION_REQUEST: 'El mensaje solicita una actuación o respuesta.',
  CONFIRMATION_REQUEST: 'El remitente solicita confirmación.',
  FOLLOW_UP_REQUEST: 'El remitente pide seguimiento de una solicitud anterior.',
  INFORMATION_ONLY: 'El mensaje aporta información sin solicitar respuesta.',
  ACKNOWLEDGEMENT_ONLY:
    'El mensaje es únicamente un agradecimiento o acuse de recibo.',
  AUTOMATED_NOTIFICATION:
    'El mensaje es un aviso informativo de una plataforma.',
  NEWSLETTER_CONTENT: 'El contenido corresponde a un boletín informativo.',
  NO_RESPONSE_EXPECTED: 'El mensaje no espera una respuesta por correo.',
  INSUFFICIENT_CONTEXT: 'Falta contexto para determinar si debe responderse.',
  AMBIGUOUS_INTENT: 'La necesidad de respuesta es ambigua.',
  HIGH_RISK: 'El mensaje requiere una decisión o revisión humana.',
  PROMPT_INJECTION:
    'El contenido intenta modificar las instrucciones o acceder a información ajena.',
  ATTACHMENT_REQUIRED: 'La solicitud depende de un adjunto que no se ha leído.',
};
export function classificationResult(
  decision: EmailClassification['decision'],
  reasons: readonly ClassificationReason[],
  extra: Partial<
    Omit<EmailClassification, 'decision' | 'reasons' | 'explanation'>
  > = {},
): EmailClassification {
  const unique = [...new Set(reasons)];
  return Object.freeze({
    intent: 'UNKNOWN',
    riskFlags: [],
    needsAttachment: false,
    source: 'RULE',
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    ...extra,
    decision,
    reasons: Object.freeze(unique),
    explanation: unique.map((reason) => explanations[reason]).join(' '),
  });
}

export const classifierMetadataHeaders = [
  'From',
  'To',
  'Cc',
  'Bcc',
  'Reply-To',
  'Subject',
  'Date',
  'Message-ID',
  'Auto-Submitted',
  'Precedence',
  'List-Id',
  'List-Unsubscribe',
  'X-Autoreply',
  'X-Autorespond',
  'Content-Type',
];
const noReply = (address: string) =>
  /^(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon)(?:[+._-]|@)/i.test(
    address,
  );

export function inspectClassifierMetadata(
  raw: GmailMessage,
  mailbox: string,
  exclusions: ResolvedClassifierExclusions,
) {
  const skip = (reason: ClassificationReason) =>
    classificationResult('NO_REPLY', [reason], {
      intent: [
        'NEWSLETTER',
        'AUTOREPLY',
        'AUTO_GENERATED',
        'NO_REPLY_ADDRESS',
      ].includes(reason)
        ? 'NOTIFICATION'
        : 'UNKNOWN',
    });
  for (const label of ['SPAM', 'TRASH'] as const)
    if (raw.labelIds?.includes(label)) return { result: skip(label) };
  if (raw.labelIds?.some((label) => ['SENT', 'DRAFT'].includes(label)))
    return { result: skip('NOT_INCOMING') };
  const warnings = new Set<import('@/modules/gmail/email').EmailParseWarning>();
  const headers = readEmailHeaders(raw.payload?.headers, warnings);
  const metadata = normalizeEmailHeaders(headers, raw.internalDate, warnings);
  if (
    metadata.from.length !== 1 ||
    metadata.replyTo.length > 1 ||
    [
      'MALFORMED_HEADERS',
      'DUPLICATE_HEADERS',
      'AMBIGUOUS_FROM',
      'INVALID_ADDRESS',
    ].some((warning) =>
      warnings.has(
        warning as import('@/modules/gmail/email').EmailParseWarning,
      ),
    ) ||
    headers.all('reply-to').length > 1 ||
    headers.all('auto-submitted').length > 1
  )
    return { result: classificationResult('UNCERTAIN', ['AMBIGUOUS_HEADERS']) };
  let addresses: string[];
  try {
    addresses = [...metadata.from, ...metadata.replyTo].map((item) =>
      normalizeClassifierAddress(item.address),
    );
  } catch {
    return { result: classificationResult('UNCERTAIN', ['AMBIGUOUS_HEADERS']) };
  }
  const sender = addresses[0];
  if (sender === mailbox) return { result: skip('NOT_INCOMING') };
  if (
    addresses.some((address) => exclusions.excludedAddresses.includes(address))
  )
    return { result: skip('EXCLUDED_SENDER') };
  if (
    addresses.some((address) =>
      exclusions.excludedDomains.some((domain) => {
        const actual = address.slice(address.lastIndexOf('@') + 1);
        return actual === domain || actual.endsWith(`.${domain}`);
      }),
    )
  )
    return { result: skip('EXCLUDED_DOMAIN') };
  if (
    headers.all('list-id').length ||
    headers
      .all('precedence')
      .some((value) => /^(bulk|list|junk)$/i.test(value.trim()))
  )
    return { result: skip('NEWSLETTER') };
  const auto = headers
    .first('auto-submitted')
    ?.split(';')[0]
    .trim()
    .toLowerCase();
  if (
    auto === 'auto-replied' ||
    ['x-autoreply', 'x-autorespond'].some((name) =>
      headers
        .all(name)
        .some((value) => !!value && !/^(?:no|false|0)$/i.test(value)),
    ) ||
    /^(?:(?:re|aw):\s*)*(?:automatic reply|auto(?:matic)?[ -]?response|out of (?:the )?office|respuesta autom[aá]tica|fuera de la oficina|abwesenheitsnotiz)(?:\s*[:—-]|\s*$)/i.test(
      metadata.subject ?? '',
    )
  )
    return { result: skip('AUTOREPLY') };
  const humanReplyTo =
    metadata.replyTo.length === 1 &&
    !noReply(addresses[1]) &&
    addresses[1] !== mailbox;
  if (auto && auto !== 'no' && !humanReplyTo)
    return { result: skip('AUTO_GENERATED') };
  if (noReply(sender) && !humanReplyTo)
    return { result: skip('NO_REPLY_ADDRESS') };
  const recipients = [...metadata.to, ...metadata.cc, ...metadata.bcc].map(
    (item) => item.address.toLowerCase(),
  );
  if (
    !recipients.includes(mailbox) ||
    recipients.some((address) => address !== mailbox)
  )
    return {
      result: classificationResult('UNCERTAIN', ['AMBIGUOUS_RECIPIENTS'], {
        riskFlags: ['GROUP_RECIPIENTS'],
      }),
    };
  return {
    metadata,
    hasUnsubscribe: headers.all('list-unsubscribe').length > 0,
    automated: !!auto && auto !== 'no',
  };
}
