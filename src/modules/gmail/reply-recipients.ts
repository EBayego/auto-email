import type { EmailAddress, NormalizedEmail } from './email';
import { gmailMimeLimits, validMimeMailbox } from './mime';

export type ReplyRecipients = {
  to: EmailAddress;
  additionalTo?: EmailAddress[];
  cc?: EmailAddress[];
};
export function replyRecipientAddresses(target: ReplyRecipients) {
  return [
    ...new Set(
      [target.to, ...(target.additionalTo ?? []), ...(target.cc ?? [])].map(
        (a) => a.address.toLowerCase(),
      ),
    ),
  ];
}
export function selectReplyRecipients(
  target: Pick<NormalizedEmail, 'from' | 'to' | 'cc' | 'bcc' | 'replyTo'>,
  identity: { mailboxAddress: string; aliases?: readonly string[] },
): ReplyRecipients | null {
  const own = new Set(
    [identity.mailboxAddress, ...(identity.aliases ?? [])].map((a) =>
      a.toLowerCase(),
    ),
  );
  if (
    target.from.length !== 1 ||
    ![...target.from, ...target.to, ...target.cc, ...target.replyTo].every(
      validMimeMailbox,
    ) ||
    target.replyTo.length > 1 ||
    (target.replyTo.length === 1 &&
      target.replyTo[0].address.toLowerCase() !==
        target.from[0].address.toLowerCase())
  )
    return null;
  const visible = [...target.to, ...target.cc];
  const visibleOwner = visible.some((a) => own.has(a.address.toLowerCase()));
  if (
    !visibleOwner &&
    !target.bcc.some((a) => own.has(a.address.toLowerCase()))
  )
    return null;
  const to = { ...target.from[0] };
  if (own.has(to.address.toLowerCase())) return null;
  const seen = new Set([...own, to.address.toLowerCase()]);
  const unique = (list: readonly EmailAddress[]) =>
    list
      .filter((a) => {
        const key = a.address.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((a) => ({ ...a }));
  // A blind copy may answer its sender without revealing membership to others.
  const additionalTo = visibleOwner ? unique(target.to) : [],
    cc = visibleOwner ? unique(target.cc) : [];
  if (1 + additionalTo.length + cc.length > gmailMimeLimits.recipients)
    return null;
  return {
    to,
    ...(additionalTo.length ? { additionalTo } : {}),
    ...(cc.length ? { cc } : {}),
  };
}
export function sameReplyRecipients(
  actual: readonly EmailAddress[],
  expected: readonly EmailAddress[],
) {
  const keys = (values: readonly EmailAddress[]) =>
    values.map((a) => a.address.toLowerCase()).sort();
  return JSON.stringify(keys(actual)) === JSON.stringify(keys(expected));
}
