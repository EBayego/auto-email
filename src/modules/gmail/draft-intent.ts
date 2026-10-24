import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { EmailAddress } from './email';
import { normalizeEmailText } from './email-content';
import { validMimeMessageId } from './mime';

export const draftIntentSchema = z.strictObject({
  version: z.literal('mail048-v1'),
  internetMessageId: z.string().refine(validMimeMessageId),
  inReplyTo: z.string().refine(validMimeMessageId),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type DraftIntent = z.infer<typeof draftIntentSchema>;
export function draftFingerprint(input: {
  from: readonly EmailAddress[];
  to: readonly EmailAddress[];
  cc: readonly EmailAddress[];
  subject: string | null;
  inReplyTo: readonly string[];
  bodyText: string;
}) {
  const addresses = (list: readonly EmailAddress[]) =>
    list.map((a) => a.address.toLowerCase()).sort();
  return createHash('sha256')
    .update(
      JSON.stringify({
        from: addresses(input.from),
        to: addresses(input.to),
        cc: addresses(input.cc),
        subject: input.subject ?? '',
        inReplyTo: [...input.inReplyTo],
        bodyText: normalizeEmailText(input.bodyText),
      }),
    )
    .digest('hex');
}
