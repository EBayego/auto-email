import { z } from 'zod';
import { draftIntentSchema } from '@/modules/gmail/draft-intent';
import { validMimeMessageId } from '@/modules/gmail/mime';
import { replyComparisonSchema } from './reply-comparison';
const gmailId = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/u);
export const replyComparisonTaskSchema = z.strictObject({
  id: z.uuid(),
  userId: z.uuid(),
  gmailAccountId: z.uuid(),
  draftGenerationId: z.uuid(),
  generationRunId: z.uuid().nullable(),
  threadId: gmailId,
  sentMessageId: gmailId,
  sentAt: z.iso.datetime({ offset: true }),
  leaseId: z.uuid(),
  attempts: z.int().min(1).max(6),
  intent: draftIntentSchema.nullable(),
  envelopeHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  draftInternetMessageId: z.string().refine(validMimeMessageId).nullable(),
});
export type ReplyComparisonTask = z.infer<typeof replyComparisonTaskSchema>;
export const comparisonSkipReasons = [
  'ORIGINAL_UNAVAILABLE',
  'INVALID_MESSAGE',
  'UNSUPPORTED_CONTENT',
  'LIMIT_EXCEEDED',
  'IDENTITY_CHANGED',
  'RETRY_LIMIT',
] as const;
export const comparisonResolutionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('COMPLETED'),
    metrics: replyComparisonSchema,
  }),
  z.strictObject({
    status: z.literal('SKIPPED'),
    reason: z.enum(comparisonSkipReasons),
  }),
  z.strictObject({
    status: z.literal('RETRY'),
    reason: z.literal('SENT_UNAVAILABLE'),
  }),
]);
export type ComparisonResolution = z.infer<typeof comparisonResolutionSchema>;
export interface ReplyComparisonStore {
  claim(limit: number): Promise<ReplyComparisonTask[]>;
  loadOriginal(task: ReplyComparisonTask): Promise<string | null>;
  finish(
    task: ReplyComparisonTask,
    result: ComparisonResolution,
  ): Promise<boolean>;
}
