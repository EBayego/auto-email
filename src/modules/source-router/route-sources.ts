import type {
  KnowledgeSource,
  SourceConfiguration,
  SourceContext,
} from './sources';

export type SourcePlan = {
  revision: string;
  matchedRuleIds: string[];
  primarySources: KnowledgeSource[];
  fallbackSources: KnowledgeSource[];
  excludedSourceIds: string[];
  allowEmailHistory: boolean;
  reason: 'MATCHED_RULES' | 'NO_MATCHING_RULE' | 'NO_AUTHORIZED_SOURCES';
};
export function sameSourcePlan(left: SourcePlan, right: SourcePlan): boolean {
  const signature = (plan: SourcePlan) => [
    plan.revision,
    plan.matchedRuleIds,
    plan.primarySources.map((s) => [s.id, s.priority, s.enabled]),
    plan.fallbackSources.map((s) => [s.id, s.priority, s.enabled]),
    plan.excludedSourceIds,
    plan.allowEmailHistory,
    plan.reason,
  ];
  return JSON.stringify(signature(left)) === JSON.stringify(signature(right));
}
export function normalizeSourceTopic(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function routeSources(
  configuration: SourceConfiguration,
  context: SourceContext,
): SourcePlan {
  const topicText = [context.query, ...context.topics]
    .map(normalizeSourceTopic)
    .map((text) => ` ${text} `);
  const rules = configuration.rules
    .filter(
      (rule) =>
        rule.enabled &&
        (rule.intent === '*' || rule.intent === context.intent) &&
        (!rule.terms.length ||
          rule.terms.some((term) => {
            const normalized = normalizeSourceTopic(term);
            return (
              normalized &&
              topicText.some((text) => text.includes(` ${normalized} `))
            );
          })),
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const excluded = new Set(rules.flatMap((rule) => rule.excludedSourceIds));
  const sources = new Map(
    configuration.sources
      .filter((source) => source.enabled)
      .map((source) => [source.id, source]),
  );
  const ordered = (kind: 'primarySourceIds' | 'fallbackSourceIds') => {
    const seen = new Set<string>();
    return rules
      .flatMap((rule) =>
        rule[kind].map((id, position) => ({
          id,
          position,
          rulePriority: rule.priority,
        })),
      )
      .filter((entry) => sources.has(entry.id) && !excluded.has(entry.id))
      .sort(
        (a, b) =>
          a.rulePriority - b.rulePriority ||
          sources.get(a.id)!.priority - sources.get(b.id)!.priority ||
          a.position - b.position ||
          a.id.localeCompare(b.id),
      )
      .filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
      })
      .map((entry) => sources.get(entry.id)!);
  };
  const primary = ordered('primarySourceIds');
  const primaryIds = new Set(primary.map((source) => source.id));
  const fallback = ordered('fallbackSourceIds').filter(
    (source) => !primaryIds.has(source.id),
  );
  return {
    revision: configuration.revision,
    matchedRuleIds: rules.map((rule) => rule.id),
    primarySources: primary,
    fallbackSources: fallback,
    excludedSourceIds: [...excluded].sort(),
    allowEmailHistory:
      rules.length > 0 && rules.every((rule) => rule.allowEmailHistory),
    reason: !rules.length
      ? 'NO_MATCHING_RULE'
      : !primary.length && !fallback.length
        ? 'NO_AUTHORIZED_SOURCES'
        : 'MATCHED_RULES',
  };
}

export async function searchWithSourcePlan<T>(
  plan: SourcePlan,
  search: (ids: string[]) => Promise<T[]>,
) {
  const primary = plan.primarySources.length
    ? await search(plan.primarySources.map((source) => source.id))
    : [];
  if (primary.length || !plan.fallbackSources.length)
    return { matches: primary, usedFallback: false };
  return {
    matches: await search(plan.fallbackSources.map((source) => source.id)),
    usedFallback: true,
  };
}
