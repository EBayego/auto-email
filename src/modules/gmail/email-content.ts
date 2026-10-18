import { randomUUID } from 'node:crypto';
import { convert, type FormatCallback } from 'html-to-text';
import {
  emailLimits,
  EmailParseError,
  type EmailSegment,
  type EmailWarnings,
} from './email';

export const normalizeEmailText = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replaceAll(String.fromCharCode(0), '')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function append(
  segments: EmailSegment[],
  kind: EmailSegment['kind'],
  text: string,
) {
  const normalized = normalizeEmailText(text);
  if (!normalized) return;
  const last = segments.at(-1);
  if (last?.kind === kind)
    segments[segments.length - 1] = {
      kind,
      text: `${last.text}\n${normalized}`,
    };
  else segments.push({ kind, text: normalized });
}

// Mark strong boundaries only. Ordinary closings such as "Gracias" remain authored.
export function segmentPlainText(
  text: string,
  warnings: EmailWarnings,
): EmailSegment[] {
  // Preserve trailing whitespace until signature detection: RFC's "-- " differs
  // from an ordinary "--" separator in an authored message.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const segments: EmailSegment[] = [];
  const lineSegment = (kind: EmailSegment['kind'], line: string) => {
    const last = segments.at(-1);
    if (last?.kind === kind)
      segments[segments.length - 1] = { kind, text: `${last.text}\n${line}` };
    else segments.push({ kind, text: line });
  };
  let tail: EmailSegment['kind'] = 'authored';
  const attributionPattern =
    /^(?:On .+wrote:|El .+escribi[oó]:|Le .+[eé]crit\s*:|Am .+schrieb.+:)$/i;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let attributionLength = attributionPattern.test(line.trim()) ? 1 : 0;
    if (!attributionLength && /^(?:On|El|Le|Am)\s/i.test(line.trim())) {
      let unfolded = line.trim();
      for (
        let offset = 1;
        offset < 4 && index + offset < lines.length;
        offset++
      ) {
        const continuation = lines[index + offset].trim();
        if (!continuation || continuation.startsWith('>')) break;
        unfolded += ` ${continuation}`;
        if (attributionPattern.test(unfolded)) {
          attributionLength = offset + 1;
          break;
        }
      }
    }
    const forwarded =
      /^\s*-{2,}\s*(?:Original Message|Mensaje original|Forwarded message|Mensaje reenviado)\s*-{2,}\s*$/i.test(
        line,
      );
    const outlook =
      /^(?:From|De):\s+.+/i.test(line) &&
      /^(?:Sent|Enviado|Date|Fecha):/im.test(
        lines.slice(index + 1, index + 4).join('\n'),
      ) &&
      /^(?:To|Para):/im.test(lines.slice(index + 1, index + 6).join('\n'));
    if (forwarded || outlook) tail = 'quoted';
    if (attributionLength) {
      // A prefixed reply can contain authored answers between quoted lines.
      const next = lines
        .slice(index + attributionLength)
        .find((entry) => entry.trim());
      if (!next?.trimStart().startsWith('>')) {
        tail = 'quoted';
        warnings.add('AMBIGUOUS_QUOTE');
      }
      lineSegment(
        'quoted',
        lines.slice(index, index + attributionLength).join('\n'),
      );
      index += attributionLength - 1;
    } else if (/^\s*>/.test(line)) {
      lineSegment('quoted', line);
    } else {
      if (
        tail !== 'quoted' &&
        (/^--[\t ]+$/.test(line) ||
          /^(?:Sent from my (?:iPhone|iPad|Android)|Enviado desde mi (?:iPhone|iPad|Android))\.?$/i.test(
            line.trim(),
          ))
      )
        tail = 'signature';
      lineSegment(tail, line);
    }
  }
  return segments
    .map((segment) => ({ ...segment, text: normalizeEmailText(segment.text) }))
    .filter((segment) => segment.text);
}

export function segmentHtml(
  html: string,
  warnings: EmailWarnings,
): EmailSegment[] {
  if (Buffer.byteLength(html) > emailLimits.bytes)
    throw new EmailParseError('LIMIT_EXCEEDED');
  const marker = `MAIL${randomUUID().replaceAll('-', '')}`;
  const boundary =
    (kind: 'Q' | 'S' | 'H'): FormatCallback =>
    (elem, walk, builder) => {
      builder.openBlock({ leadingLineBreaks: 1 });
      builder.addLiteral(`${marker}${kind}+\n`);
      walk(elem.children, builder);
      builder.addLiteral(`\n${marker}${kind}-`);
      builder.closeBlock({ trailingLineBreaks: 1 });
    };
  const text = convert(html, {
    wordwrap: false,
    limits: {
      maxInputLength: emailLimits.bytes,
      maxDepth: 100,
      maxChildNodes: 10000,
      ellipsis: `${marker}LIMIT`,
    },
    formatters: {
      quoted: boundary('Q'),
      signature: boundary('S'),
      history: boundary('H'),
    },
    selectors: [
      ...[
        'script',
        'style',
        'head',
        'iframe',
        'object',
        'svg',
        'canvas',
        'template',
        'img',
      ].map((selector) => ({ selector, format: 'skip' })),
      { selector: 'a', options: { ignoreHref: true } },
      ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
        selector,
        options: { uppercase: false },
      })),
      ...[
        'blockquote',
        '.gmail_quote',
        '.yahoo_quoted',
        '.moz-cite-prefix',
      ].map((selector) => ({ selector, format: 'quoted' })),
      ...[
        '.gmail_signature',
        '.moz-signature',
        'div[data-smartmail="gmail_signature"]',
      ].map((selector) => ({ selector, format: 'signature' })),
      { selector: '#divRplyFwdMsg', format: 'history' },
      { selector: '.OutlookMessageHeader', format: 'history' },
    ],
  });
  if (text.includes(`${marker}LIMIT`))
    throw new EmailParseError('LIMIT_EXCEEDED');
  const segments: EmailSegment[] = [];
  const stack: ('Q' | 'S' | 'H')[] = [];
  const pattern = new RegExp(`${marker}([QSH])([+-])`, 'g');
  let previous = 0;
  const add = (value: string) => {
    if (stack.includes('Q') || stack.includes('H'))
      append(segments, 'quoted', value);
    else if (stack.includes('S')) append(segments, 'signature', value);
    else
      for (const segment of segmentPlainText(value, warnings))
        append(segments, segment.kind, segment.text);
  };
  for (const match of text.matchAll(pattern)) {
    add(text.slice(previous, match.index));
    const kind = match[1] as 'Q' | 'S' | 'H';
    if (match[2] === '+') stack.push(kind);
    // An Outlook header starts unprefixed history, which extends past the header div.
    else if (kind !== 'H') stack.splice(stack.lastIndexOf(kind), 1);
    else warnings.add('AMBIGUOUS_QUOTE');
    previous = match.index! + match[0].length;
  }
  add(text.slice(previous));
  return segments;
}
