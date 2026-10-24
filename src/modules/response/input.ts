import { z } from 'zod';
import { writingProfileZodSchema } from '@/modules/identity/writing-profile';
import { stylePreferenceSchema } from '@/modules/identity/style-preferences';
import { knowledgeContextSchema } from '@/modules/knowledge/retriever';
import { knowledgePolicySchema } from '@/modules/policy/knowledge-policy';
import { recipientSchema } from '@/modules/knowledge/audience';
import {
  policyContextSchema,
  responsePolicySettingsSchema,
} from '@/modules/policy/settings';
import {
  ResponseGenerationError,
  responseLimits,
  type GenerateReplyInput,
} from './contracts';

const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (value) =>
        !!value.trim() &&
        value.isWellFormed() &&
        !/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\r\n\t\u200c\u200d]/gu, '')),
    );
const message = {
  speaker: z.string().regex(/^(?:owner|participant_\d{1,2})$/),
  text: text(64 * 1024),
};
// Unknown routing/provider metadata is stripped before either model call.
export const generateReplyInputSchema = z
  .object({
    recipient: recipientSchema.optional(),
    recipients: z.array(recipientSchema).min(1).max(50).optional(),
    messageAudiences: z
      .array(z.array(recipientSchema).max(101))
      .max(responseLimits.messages)
      .optional(),
    conversation: z.object({
      schemaVersion: z.literal(1),
      subject: z
        .string()
        .max(4096)
        .refine(
          (v) =>
            v.isWellFormed() &&
            !/[\p{Cc}\p{Cf}]/u.test(v.replace(/[\u200c\u200d]/gu, '')),
        )
        .nullable(),
      messages: z
        .array(z.object({ ...message, isTarget: z.boolean() }))
        .min(1)
        .max(responseLimits.messages),
      style: writingProfileZodSchema.nullable(),
    }),
    historicalContext: z
      .array(
        z.object({
          referenceId: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/),
          recipient: recipientSchema.optional(),
          ...message,
        }),
      )
      .max(responseLimits.messages - 1)
      .optional(),
    styleExamples: z
      .array(z.object({ text: text(responseLimits.exampleCharacters) }))
      .max(responseLimits.examples)
      .optional(),
    userInstructions: z.array(text(300)).max(5).optional(),
    stylePreferences: z.array(stylePreferenceSchema).max(8).optional(),
    knowledge: knowledgeContextSchema.optional(),
    knowledgePolicy: knowledgePolicySchema.optional(),
    allowPartialDrafts: z.boolean().optional(),
    allowEmailHistory: z.boolean().optional(),
    responsePolicy: responsePolicySettingsSchema.optional(),
    policyContext: policyContextSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const messages = input.conversation.messages;
    const history = input.historicalContext ?? [];
    if (
      (input.recipients &&
        (!input.recipient || !input.recipients.includes(input.recipient))) ||
      (input.messageAudiences &&
        input.messageAudiences.length !== messages.length) ||
      messages.filter((m) => m.isTarget).length !== 1 ||
      !messages.at(-1)?.isTarget ||
      messages.at(-1)?.speaker === 'owner' ||
      history.length + messages.length > responseLimits.messages ||
      (history.length > 0 && input.allowEmailHistory !== true) ||
      new Set(history.map((m) => m.referenceId)).size !== history.length
    )
      ctx.addIssue({ code: 'custom', message: 'INVALID_REPLY_CONTEXT' });
  });

export function parseGenerateReplyInput(
  input: GenerateReplyInput,
): GenerateReplyInput {
  const parsed = generateReplyInputSchema.safeParse(input);
  if (!parsed.success) throw new ResponseGenerationError('INVALID_INPUT');
  return parsed.data;
}
