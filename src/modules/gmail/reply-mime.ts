import type { PreparedReplyContext } from './manual-selection';
import { DraftWriteError } from './draft-contracts';
import { buildGmailMime, validMimeMessageId } from './mime';

export function buildReplyMime(input: {
  from: string;
  target: PreparedReplyContext['replyTarget'];
  bodyText: string;
  attemptId: string;
  now?: Date;
  format?: 'plain' | 'alternative';
}) {
  const target = input.target;
  if (
    !target ||
    !validMimeMessageId(target.inReplyTo) ||
    !Array.isArray(target.references) ||
    target.references.length > 100 ||
    !target.references.every(validMimeMessageId) ||
    (target.additionalTo !== undefined &&
      !Array.isArray(target.additionalTo)) ||
    (target.cc !== undefined && !Array.isArray(target.cc)) ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(input.attemptId)
  )
    throw new DraftWriteError('INVALID_INPUT');
  const references = [
    ...new Set([
      ...target.references.filter((id) => id !== target.inReplyTo),
      target.inReplyTo,
    ]),
  ];
  return buildGmailMime({
    from: { name: '', address: input.from },
    to: [target.to, ...(target.additionalTo ?? [])],
    cc: target.cc,
    subject: target.subject ?? '',
    bodyText: input.bodyText,
    internetMessageId: `<mail021.${input.attemptId}@auto-email.invalid>`,
    inReplyTo: target.inReplyTo,
    references,
    now: input.now,
    format: input.format,
    correlationId: input.attemptId,
  });
}
