import { z } from 'zod';

// Only identifiers belong in persistent provenance, never quotes or email text.
export const replySourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('THREAD_MESSAGE'),
    messageIndex: z.int().min(0).max(19),
  }),
  z.strictObject({
    kind: z.literal('HISTORICAL_MESSAGE'),
    referenceId: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/),
  }),
  z.strictObject({
    kind: z.literal('KNOWLEDGE_FRAGMENT'),
    sourceId: z.uuid(),
    documentId: z.uuid(),
    version: z.int().min(1).max(2147483647),
    chunkId: z.uuid(),
  }),
]);
export const replySourcesSchema = z
  .array(replySourceSchema)
  .max(12)
  .refine((items) => {
    const keys = items.map((item) => JSON.stringify(item));
    return new Set(keys).size === keys.length;
  });
export type ReplySource = z.infer<typeof replySourceSchema>;
