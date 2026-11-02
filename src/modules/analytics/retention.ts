import { z } from 'zod';
export const generationVersion = 'mail056-v1';
export const generationRetentionUpdateSchema = z.discriminatedUnion('enabled', [
  z.strictObject({ accountId: z.uuid(), enabled: z.literal(false) }),
  z.strictObject({
    accountId: z.uuid(),
    enabled: z.literal(true),
    retentionHours: z.int().min(1).max(168),
    noticeVersion: z.literal(generationVersion),
  }),
]);
export const generationRetentionSnapshotSchema = z.discriminatedUnion(
  'enabled',
  [
    z.strictObject({
      accountId: z.uuid(),
      enabled: z.literal(false),
      retentionHours: z.null(),
      noticeVersion: z.null(),
      authorizedAt: z.null(),
    }),
    z.strictObject({
      accountId: z.uuid(),
      enabled: z.literal(true),
      retentionHours: z.int().min(1).max(168),
      noticeVersion: z.literal(generationVersion),
      authorizedAt: z.iso.datetime({ offset: true }),
    }),
  ],
);
export type GenerationRetentionSnapshot = z.infer<
  typeof generationRetentionSnapshotSchema
>;
