import { z } from 'zod';
import { classificationIntents } from '@/modules/classifier/contracts';

const uuid = z.uuid();
const title = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));
const sourceList = z.array(uuid).max(20);
export const sourceOperationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set_sufficiency_preferences'),
      allowPartialDrafts: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('save_source'),
      id: uuid.optional(),
      title,
      priority: z.int().min(0).max(1000),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('delete_source'), id: uuid }).strict(),
  z
    .object({
      action: z.literal('assign_document'),
      documentId: uuid,
      sourceId: uuid.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('save_rule'),
      id: uuid.optional(),
      title,
      intent: z.enum(['*', ...classificationIntents]),
      terms: z.array(title.max(60)).max(10),
      priority: z.int().min(0).max(1000),
      enabled: z.boolean(),
      allowEmailHistory: z.boolean(),
      primarySourceIds: sourceList.min(1),
      fallbackSourceIds: sourceList,
      excludedSourceIds: sourceList,
    })
    .strict()
    .refine((value) => {
      const ids = [
        ...value.primarySourceIds,
        ...value.fallbackSourceIds,
        ...value.excludedSourceIds,
      ];
      return new Set(ids).size === ids.length;
    }, 'Las fuentes principales, de respaldo y excluidas deben ser distintas'),
  z.object({ action: z.literal('delete_rule'), id: uuid }).strict(),
]);
export type SourceOperation = z.infer<typeof sourceOperationSchema>;
export type KnowledgeSource = {
  id: string;
  title: string;
  priority: number;
  enabled: boolean;
};
export type SourceRule = {
  id: string;
  title: string;
  intent: '*' | (typeof classificationIntents)[number];
  terms: string[];
  priority: number;
  enabled: boolean;
  allowEmailHistory: boolean;
  primarySourceIds: string[];
  fallbackSourceIds: string[];
  excludedSourceIds: string[];
};
export type SourceConfiguration = {
  revision: string;
  allowPartialDrafts: boolean;
  sources: KnowledgeSource[];
  rules: SourceRule[];
};
export const sourceContextSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    intent: z.enum(classificationIntents),
    topics: z.array(title.max(60)).max(10).default([]),
  })
  .strict();
export type SourceContext = z.infer<typeof sourceContextSchema>;
export class SourceConfigurationError extends Error {
  constructor(
    readonly code:
      | 'SOURCE_LIMIT'
      | 'RULE_LIMIT'
      | 'SOURCE_IN_USE'
      | 'SOURCE_CONFIGURATION_CHANGED',
  ) {
    super(code);
  }
}
