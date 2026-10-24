import { z } from 'zod';

export const recipientSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const documentAudienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('GENERAL'), key: z.literal('') }),
  z.strictObject({ kind: z.literal('RECIPIENT'), key: recipientSchema }),
  z.strictObject({
    kind: z.literal('DOMAIN'),
    key: z
      .string()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i)
      .transform((v) => v.toLowerCase()),
  }),
]);
export type DocumentAudience = z.infer<typeof documentAudienceSchema>;

export function audienceMatches(
  audience: { audience_kind?: DocumentAudience['kind']; audience_key?: string },
  recipient?: string,
) {
  const parsed = documentAudienceSchema.safeParse({
    kind: audience.audience_kind ?? 'GENERAL',
    key: audience.audience_key ?? '',
  });
  if (!parsed.success) return false;
  if (parsed.data.kind === 'GENERAL') return true;
  const address = recipientSchema.safeParse(recipient);
  if (!address.success) return false;
  return (
    parsed.data.key ===
    (parsed.data.kind === 'RECIPIENT'
      ? address.data
      : address.data.split('@')[1])
  );
}
export function audienceMatchesAll(
  audience: Parameters<typeof audienceMatches>[0],
  recipient?: string,
  recipients?: readonly string[],
) {
  const addresses = [
    ...new Set([...(recipient ? [recipient] : []), ...(recipients ?? [])]),
  ];
  return addresses.length
    ? addresses.every((address) => audienceMatches(audience, address))
    : audienceMatches(audience);
}
