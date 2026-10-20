import { z } from 'zod';
import type { StyleSampleMessage } from './sent-sample';
import type { WritingProfile } from './writing-profile';

export const relationshipCategories = [
  'CLIENT',
  'COLLEAGUE',
  'SUPPLIER',
  'MANAGEMENT',
  'OTHER',
] as const;
const recipient = z
  .string()
  .max(254)
  .regex(/^[^\s<>@]+@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d-]+$/i);
const domain = z
  .string()
  .max(253)
  .regex(/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d-]+$/i);
export const styleScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('GENERAL'), key: z.literal('') }),
  z.strictObject({ kind: z.literal('RECIPIENT'), key: recipient }),
  z.strictObject({ kind: z.literal('DOMAIN'), key: domain }),
  z.strictObject({
    kind: z.literal('RELATIONSHIP'),
    key: z.enum(relationshipCategories),
  }),
]);
export type StyleScope = z.infer<typeof styleScopeSchema>;
export type RelationshipCategory = (typeof relationshipCategories)[number];
export type RelationshipRule = {
  kind: 'RECIPIENT' | 'DOMAIN';
  key: string;
  category: RelationshipCategory;
};
export class ContextualStyleError extends Error {
  constructor(
    public readonly code: 'INVALID_CONTEXT' | 'GENERAL_PROFILE_REQUIRED',
  ) {
    super(code);
    this.name = 'ContextualStyleError';
  }
}
export function normalizeStyleScope(value: unknown): StyleScope {
  const parsed = styleScopeSchema.safeParse(value);
  if (!parsed.success) throw new ContextualStyleError('INVALID_CONTEXT');
  const scope = parsed.data;
  return scope.kind === 'RECIPIENT' || scope.kind === 'DOMAIN'
    ? { ...scope, key: scope.key.toLowerCase() }
    : scope;
}
export function validateRelationshipRule(
  value: RelationshipRule,
): RelationshipRule {
  const scope = normalizeStyleScope({ kind: value?.kind, key: value?.key });
  if (
    (scope.kind !== 'RECIPIENT' && scope.kind !== 'DOMAIN') ||
    !relationshipCategories.includes(value.category)
  )
    throw new ContextualStyleError('INVALID_CONTEXT');
  return { ...scope, category: value.category };
}
export const contextualStyleLimits = Object.freeze({
  messages: 10,
  threads: 3,
  words: 120,
  days: 2,
  domainRecipients: 3,
  relationshipRecipients: 2,
  profiles: 12,
  rules: 200,
  maxAgeMs: 90 * 86400000,
});
export const contextEvidenceSchema = z.strictObject({
  threads: z.int().min(3).max(500),
  recipients: z.int().min(1).max(500),
  words: z.int().min(120).max(5000000),
  days: z.int().min(2).max(500),
});
export type ContextEvidence = z.infer<typeof contextEvidenceSchema>;
export function sufficientContext(
  scope: StyleScope,
  count: number,
  evidence: ContextEvidence,
): boolean {
  return (
    scope.kind !== 'GENERAL' &&
    count >= contextualStyleLimits.messages &&
    count <= 500 &&
    contextEvidenceSchema.safeParse(evidence).success &&
    evidence.threads <= count &&
    evidence.recipients <= count &&
    evidence.days <= count &&
    (scope.kind !== 'RECIPIENT' || evidence.recipients === 1) &&
    (scope.kind !== 'DOMAIN' ||
      evidence.recipients >= contextualStyleLimits.domainRecipients) &&
    (scope.kind !== 'RELATIONSHIP' ||
      evidence.recipients >= contextualStyleLimits.relationshipRecipients)
  );
}
export function relationshipFor(
  recipientAddress: string,
  rules: readonly RelationshipRule[],
): RelationshipCategory | null {
  const target = normalizeStyleScope({
    kind: 'RECIPIENT',
    key: recipientAddress,
  });
  const host = target.key.split('@')[1];
  return (
    rules.find((r) => r.kind === 'RECIPIENT' && r.key === target.key)
      ?.category ??
    rules.find((r) => r.kind === 'DOMAIN' && r.key === host)?.category ??
    null
  );
}
// A shared mail provider is not evidence that its users share a relationship.
const publicMailDomains = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.es',
  'live.com',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);
export type ContextualStyleGroup = {
  scope: StyleScope;
  messages: StyleSampleMessage[];
  evidence: ContextEvidence;
};
export function groupContextualSamples(
  messages: readonly StyleSampleMessage[],
  inputRules: readonly RelationshipRule[] = [],
): ContextualStyleGroup[] {
  if (messages.length > 500 || inputRules.length > contextualStyleLimits.rules)
    throw new ContextualStyleError('INVALID_CONTEXT');
  const rules = inputRules.map(validateRelationshipRule);
  if (new Set(rules.map((r) => `${r.kind}:${r.key}`)).size !== rules.length)
    throw new ContextualStyleError('INVALID_CONTEXT');
  const groups = new Map<
    string,
    { scope: StyleScope; messages: StyleSampleMessage[] }
  >();
  const seen = new Set<string>();
  for (const message of messages) {
    const context = message.context;
    if (!context || seen.has(message.id)) continue;
    if (
      !recipient.safeParse(context.recipient).success ||
      !Number.isFinite(Date.parse(context.sentAt))
    )
      continue;
    seen.add(message.id);
    const scope = normalizeStyleScope({
      kind: 'RECIPIENT',
      key: context.recipient,
    });
    const host = scope.key.split('@')[1];
    const category = relationshipFor(scope.key, rules);
    const scopes: StyleScope[] = [scope];
    if (!publicMailDomains.has(host))
      scopes.push({ kind: 'DOMAIN', key: host });
    if (category) scopes.push({ kind: 'RELATIONSHIP', key: category });
    for (const target of scopes) {
      const key = `${target.kind}:${target.key}`;
      const group = groups.get(key) ?? { scope: target, messages: [] };
      group.messages.push(message);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      evidence: {
        threads: new Set(group.messages.map((m) => m.threadId)).size,
        recipients: new Set(
          group.messages.map((m) => m.context!.recipient.toLowerCase()),
        ).size,
        words: group.messages.reduce((sum, m) => sum + m.wordCount, 0),
        days: new Set(
          group.messages.map((m) =>
            new Date(m.context!.sentAt).toISOString().slice(0, 10),
          ),
        ).size,
      },
    }))
    .filter((g) => sufficientContext(g.scope, g.messages.length, g.evidence))
    .sort(
      (a, b) =>
        b.messages.length - a.messages.length ||
        `${a.scope.kind}:${a.scope.key}`.localeCompare(
          `${b.scope.kind}:${b.scope.key}`,
        ),
    )
    .slice(0, contextualStyleLimits.profiles);
}
export function styleVariations(
  general: WritingProfile,
  contextual: WritingProfile,
) {
  return (['formality', 'average_length', 'language'] as const).filter(
    (key) => general[key] !== contextual[key],
  );
}
