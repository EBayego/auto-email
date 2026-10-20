import type {
  EmailHeader,
  EmailSegment,
  NormalizedEmail,
} from '@/modules/gmail/email';
import { normalizeEmailText } from '@/modules/gmail/email-content';
import { readEmailHeaders } from '@/modules/gmail/email-headers';

export type StyleEmailSegment = Readonly<{
  kind: EmailSegment['kind'] | 'legal';
  text: string;
}>;
export type PreprocessedStyleEmail = Readonly<{
  authoredText: string;
  inheritedText: string;
  segments: readonly StyleEmailSegment[];
  exclusion: 'AUTOMATED' | null;
  hasForwardedContent: boolean;
}>;

const forwardBoundary =
  /^(?:-{2,}\s*(?:forwarded message|mensaje reenviado|mensagem encaminhada)\s*-{2,}|(?:begin forwarded message|inicio del mensaje reenviado|in[ií]cio da mensagem encaminhada):)\s*$/i;
const originalMessageBoundary =
  /^-{2,}\s*(?:original message|mensaje original)\s*-{2,}\s*$/i;
const mobileSignature =
  /^(?:(?:Sent from my|Enviado desde mi) (?:iPhone|iPad|Android)|(?:Sent from|Enviado desde|Get|Obtener) Outlook (?:for|para) (?:iOS|Android)|Sent from (?:Mail for Windows|Samsung Mobile))\.?$/i;
const environmentalNotice =
  /^(?:Please consider (?:the environment|your environmental responsibility) before printing this (?:e-?mail|message)|Antes de imprimir este (?:correo|mensaje),? piense en el medio ambiente)\.?$/i;
const closing =
  /^(?:gracias|muchas gracias|un saludo|saludos|atentamente|thanks|thank you|regards|kind regards|best regards|cheers)[,!. ]*$/i;

// Require a boilerplate opening and independent legal signals. A personal sentence
// about confidentiality, a contract, or data protection is still writing evidence.
function isLegalNotice(paragraph: string): boolean {
  const text = paragraph.replace(/\s+/g, ' ');
  return (
    /^(?:(?:aviso legal|confidencialidad|confidentiality notice|disclaimer)\s*[:.-]?\s*)?(?:este (?:mensaje|correo|e-?mail)|la informaci[oó]n contenida en este|this (?:message|e-?mail)|the information contained in this)\b/i.test(
      text,
    ) &&
    /confiden[ct]ial|privileged|privilegiad|reservad/i.test(text) &&
    /dirigid[oa].{0,80}destinatari|intended recipient|addressee|received (?:it|this|this message) in error|recibido.+error|distribuci[oó]n|disclosure|dissemination|copying/i.test(
      text,
    )
  );
}

function isLegalContinuation(paragraph: string): boolean {
  return /^(?:si (?:usted )?no (?:es|eres) (?:el )?destinatario|si (?:usted )?(?:lo )?ha recibido.{0,80}(?:error|equivocaci[oó]n)|if you (?:are not (?:the )?(?:intended )?recipient|have received.{0,80}in error)|queda (?:prohibida|prohibido)|any (?:unauthori[sz]ed|disclosure)|cualquier (?:uso|distribuci[oó]n|copia))\b/i.test(
    paragraph,
  );
}

function contactKind(line: string): string | null {
  if (
    /^(?:(?:e-?mail|correo(?: electr[oó]nico)?)\s*:\s*)?[^\s<>@]+@[^\s<>@]+$/i.test(
      line,
    )
  )
    return 'email';
  if (
    /^(?:(?:tel(?:[eé]fono)?|phone|m[oó]vil|mobile|t|m|fax)\.?\s*[:+]?\s*)?\+?[\d ()/.-]{7,25}$/i.test(
      line,
    )
  )
    return 'phone';
  if (/^(?:(?:web|website)\s*:\s*)?(?:https?:\/\/|www\.)\S+$/i.test(line))
    return 'web';
  return null;
}

function contactSignatureStart(lines: string[], authorName: string): number {
  // Inspect only a compact trailing block with at least two kinds of contact
  // details. Names or ordinary sign-offs alone are deliberately insufficient.
  let start = lines.length;
  const kinds = new Set<string>();
  let identityLines = 0;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
    const line = lines[i].trim();
    if (!line || closing.test(line)) break;
    const kind = contactKind(line);
    if (kind) kinds.add(kind);
    else if (
      kinds.size &&
      identityLines < 3 &&
      line.length <= 80 &&
      (line.toLocaleLowerCase() === authorName.toLocaleLowerCase() ||
        /^\p{Lu}[\p{L}'’.-]*(?:[ &|/-]+(?:\p{Lu}[\p{L}'’.-]*|de|del|la|y|and)){0,6}$/u.test(
          line,
        ))
    )
      identityLines++;
    else break;
    start = i;
  }
  return kinds.size >= 2 ? start : lines.length;
}

function historyStart(lines: string[], index: number): boolean {
  const line = lines[index].trim();
  if (forwardBoundary.test(line) || originalMessageBoundary.test(line))
    return true;
  // Outlook/Apple/localised headers need a cluster, never just "De:" in prose.
  if (/^(?:From|De|Von|Da):\s*\S/i.test(line)) {
    const following = lines.slice(index + 1, index + 9).join('\n');
    return (
      /^(?:Sent|Enviado|Enviad[oa] em|Date|Fecha|Gesendet|Data):\s*\S/im.test(
        following,
      ) && /^(?:To|Para|An|A):\s*\S/im.test(following)
    );
  }
  // Additional localised attributions need a date/address to distinguish them
  // from authored prose such as "El cliente escribió:".
  if (!/^(?:Em|Il)\s/i.test(line)) return false;
  let attribution = '';
  for (const next of lines.slice(index, index + 3)) {
    if (!next.trim() || next.trimStart().startsWith('>')) break;
    attribution += ` ${next.trim()}`;
    if (
      /^(?:Em .+escreveu:|Il .+(?:ha scritto|scrive):)\s*$/i.test(
        attribution.trim(),
      ) &&
      /\d|[^\s<>@]+@[^\s<>@]+/.test(attribution)
    )
      return true;
  }
  return false;
}

function cleanAuthored(text: string, authorName: string): StyleEmailSegment[] {
  const lines = text.split('\n');
  const boundary = lines.findIndex((_, index) => historyStart(lines, index));
  const current = boundary < 0 ? text : lines.slice(0, boundary).join('\n');
  const result: StyleEmailSegment[] = [];
  let legal = false;
  const paragraphs = current.split(/\n\s*\n/);
  for (const [index, paragraph] of paragraphs.entries()) {
    if (
      /^(?:aviso legal|confidencialidad|confidentiality notice|disclaimer)\s*:?$/i.test(
        paragraph,
      ) &&
      isLegalNotice(paragraphs[index + 1] ?? '')
    ) {
      result.push({ kind: 'legal', text: paragraph });
      continue;
    }
    if (isLegalNotice(paragraph) || (legal && isLegalContinuation(paragraph))) {
      result.push({ kind: 'legal', text: paragraph });
      legal = true;
      continue;
    }
    legal = false;
    const paragraphLines = paragraph.split('\n');
    const contactStart = contactSignatureStart(paragraphLines, authorName);
    let authored: string[] = [];
    const flush = () => {
      const value = normalizeEmailText(authored.join('\n'));
      if (value) result.push({ kind: 'authored', text: value });
      authored = [];
    };
    for (let i = 0; i < paragraphLines.length; i++) {
      const line = paragraphLines[i].trim();
      if (
        i >= contactStart ||
        mobileSignature.test(line) ||
        environmentalNotice.test(line)
      ) {
        flush();
        result.push({ kind: 'signature', text: paragraphLines[i] });
      } else authored.push(paragraphLines[i]);
    }
    flush();
  }
  if (boundary >= 0)
    result.push({ kind: 'quoted', text: lines.slice(boundary).join('\n') });
  return result;
}

function automatedBody(text: string): boolean {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' '));
  if (
    paragraphs.some((paragraph) =>
      /^(?:(?:este (?:mensaje|correo(?: electr[oó]nico)?) (?:se ha generado|ha sido generado)|mensaje generado) autom[aá]ticamente|this (?:is an automatically generated (?:message|e-?mail)|(?:message|e-?mail) (?:was|has been) (?:automatically generated|generated automatically)))[.! ]*(?:(?:por favor,? )?no respond[ae]s? (?:a este (?:mensaje|correo))?[.! ]*|please do not reply(?: to this (?:message|e-?mail))?[.! ]*)?$/i.test(
        paragraph,
      ),
    )
  )
    return true;
  // An unsubscribe phrase alone may be a personal explanation. Require the
  // subscription boilerplate as well, in the same trailing campaign footer.
  const footer = paragraphs.slice(-3).join(' ');
  return (
    /(?:recibes|recibe|has recibido) este (?:correo|mensaje) porque (?:te has suscrito|est[aá]s suscrito|formas parte)|you (?:are receiving|received) this (?:e-?mail|message) because you (?:subscribed|signed up)/i.test(
      footer,
    ) &&
    /\b(?:darte de baja|darse de baja|cancelar (?:tu |la )?suscripci[oó]n|unsubscribe)\b/i.test(
      footer,
    )
  );
}

export class EmailStylePreprocessor {
  metadataExclusion(
    email: Pick<NormalizedEmail, 'from' | 'to' | 'cc' | 'bcc' | 'subject'>,
    rawHeaders: readonly EmailHeader[] = [],
  ): 'AUTOMATED' | null {
    const headers = readEmailHeaders(rawHeaders, new Set());
    if (
      headers
        .all('auto-submitted')
        .some((value) => value.toLowerCase().split(';')[0].trim() !== 'no') ||
      headers
        .all('precedence')
        .some((value) => /^(?:bulk|junk|list)$/i.test(value)) ||
      ['list-id', 'list-unsubscribe', 'x-autoreply', 'x-autorespond'].some(
        (name) => headers.all(name).length,
      ) ||
      [...email.from, ...email.to, ...email.cc, ...email.bcc].some(
        ({ address }) =>
          /^(?:no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon)(?:[+._-]|@)/i.test(
            address,
          ),
      ) ||
      /^(?:(?:re|aw):\s*)*(?:automatic reply|auto(?:matic)?[ -]?response|out of (?:the )?office|respuesta autom[aá]tica|fuera de la oficina|abwesenheitsnotiz)\b/i.test(
        email.subject ?? '',
      )
    )
      return 'AUTOMATED';
    return null;
  }

  preprocess(
    email: NormalizedEmail,
    headers: readonly EmailHeader[] = [],
  ): PreprocessedStyleEmail {
    const segments = email.segments.flatMap((segment) =>
      segment.kind === 'authored'
        ? cleanAuthored(segment.text, email.from[0]?.name ?? '')
        : [{ kind: segment.kind, text: segment.text }],
    );
    const authoredText = normalizeEmailText(
      segments
        .filter((s) => s.kind === 'authored')
        .map((s) => s.text)
        .join('\n\n'),
    );
    return {
      authoredText,
      inheritedText: normalizeEmailText(
        segments
          .filter((s) => s.kind === 'quoted')
          .map((s) => s.text)
          .join('\n\n'),
      ),
      segments,
      exclusion:
        this.metadataExclusion(email, headers) ??
        (automatedBody(authoredText) ? 'AUTOMATED' : null),
      hasForwardedContent: email.bodyText
        .split('\n')
        .some((line) => forwardBoundary.test(line.trim())),
    };
  }
}
