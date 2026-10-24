import { z } from 'zod';
import {
  audienceMatchesAll,
  documentAudienceSchema,
  recipientSchema,
} from './audience';
import {
  classificationIntents,
  type EmailClassification,
} from '@/modules/classifier/contracts';
import type { SourceConfiguration } from '@/modules/source-router/sources';
import {
  normalizeSourceTopic,
  routeSources,
  sameSourcePlan,
  type SourcePlan,
} from '@/modules/source-router/route-sources';
import {
  knowledgeCurrency,
  knowledgeReferenceId,
  reviewKnowledge,
  type KnowledgeReview,
} from './provenance';
import {
  evaluateKnowledgePolicy,
  type KnowledgePolicyResult,
} from '@/modules/policy/knowledge-policy';
import {
  assessEvidence,
  evidenceTopicMatches,
  type EvidenceSufficiency,
} from './sufficiency';

export const retrievalLimits = Object.freeze({
  fragments: 8,
  contextTokens: 12000,
  candidatesPerSource: 20,
  questionCharacters: 12000,
});
const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (s) =>
        s.isWellFormed() &&
        !/[\p{Cc}\p{Cf}]/u.test(s.replace(/[\r\n\t\u200c\u200d]/gu, '')),
    );
export const knowledgeFragmentSchema = z
  .object({
    source_id: z.uuid(),
    source_title: safeText(100),
    source_priority: z.int().min(0).max(1000),
    chunk_id: z.uuid(),
    document_id: z.uuid(),
    document_name: safeText(200),
    version: z.int().min(1),
    document_updated_at: z.iso.datetime({ offset: true }),
    valid_from: z.iso.date().nullable(),
    valid_until: z.iso.date().nullable(),
    audience_kind: z.enum(['GENERAL', 'RECIPIENT', 'DOMAIN']).optional(),
    audience_key: z.string().max(254).optional(),
    position: z.int().min(0),
    section: z.string().max(1000),
    content: safeText(4000),
    start_offset: z.int().min(0),
    end_offset: z.int().min(1),
    page_start: z.int().min(1).nullable(),
    page_end: z.int().min(1).nullable(),
  })
  .strict()
  .refine(
    (f) =>
      documentAudienceSchema.safeParse({
        kind: f.audience_kind ?? 'GENERAL',
        key: f.audience_key ?? '',
      }).success,
  )
  .refine(
    (c) =>
      c.end_offset > c.start_offset &&
      (!c.valid_from || !c.valid_until || c.valid_from <= c.valid_until) &&
      ((c.page_start === null && c.page_end === null) ||
        (c.page_start !== null &&
          c.page_end !== null &&
          c.page_end >= c.page_start)),
  );
export type KnowledgeFragment = z.infer<typeof knowledgeFragmentSchema>;
export const knowledgeContextSchema = z
  .array(knowledgeFragmentSchema)
  .max(retrievalLimits.fragments);
const inputSchema = z
  .object({
    question: safeText(retrievalLimits.questionCharacters)
      .transform((s) => s.trim())
      .pipe(z.string().min(1)),
    intent: z.enum(classificationIntents),
    topics: z.array(safeText(60)).max(10).default([]),
    allowedSourceIds: z.array(z.uuid()).max(20).optional(),
    recipient: recipientSchema.optional(),
    recipients: z.array(recipientSchema).min(1).max(50).optional(),
    maxFragments: z.int().min(1).max(retrievalLimits.fragments).default(6),
    maxContextTokens: z
      .int()
      .min(256)
      .max(retrievalLimits.contextTokens)
      .default(6000),
  })
  .strict();
export type KnowledgeRetrievalInput = z.input<typeof inputSchema>;
export type KnowledgeRetrievalResult = {
  classification?: Pick<EmailClassification, 'intent' | 'riskFlags'>;
  plan: SourcePlan;
  matches: KnowledgeFragment[];
  usedFallback: boolean;
  tokenUpperBound: number;
  truncated: boolean;
  review: KnowledgeReview;
  policy: KnowledgePolicyResult;
  sufficiency: EvidenceSufficiency;
  allowPartialDrafts: boolean;
};
export interface KnowledgeRetriever {
  retrieve(
    input: KnowledgeRetrievalInput,
    expectedPlan?: SourcePlan,
  ): Promise<KnowledgeRetrievalResult>;
}
export class KnowledgeRetrievalError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'UNAVAILABLE') {
    super(code);
    this.name = 'KnowledgeRetrievalError';
  }
}
export type KnowledgeCandidate = Omit<KnowledgeFragment, 'source_priority'> & {
  rank: number;
};
type Dependencies = {
  configuration(): Promise<SourceConfiguration>;
  search(input: {
    query: string;
    sourceIds: string[];
    revision: string;
    limit: number;
    recipient?: string;
  }): Promise<KnowledgeCandidate[]>;
  assertRevision(revision: string): Promise<void>;
  now?(): Date;
};

// A byte bound includes JSON metadata and escaping, rather than assuming a
// characters/token ratio that undercounts numbers, Unicode and punctuation.
export const knowledgeTokenUpperBound = (
  fragments: readonly KnowledgeFragment[],
) => Buffer.byteLength(JSON.stringify(fragments), 'utf8') + 8;
const stopwords = new Set(
  (
    'a al algo ante bajo con como cual cuales cuando de del desde donde el ella en entre es esa ese esta este esto estos ha hay hasta la las lo los mas me mi mis muy no nos o os para pero por porque que quien se ser si sin sobre su sus te tiene tu tus un una unas uno unos y ya ' +
    'the a an and or to of for from in on at is are was were be been it its this that these those with without do does did can could would will you your we our i my please ' +
    'hola buenos buenas dias tardes gracias favor saber quisiera quiero necesito informacion informar indicar indicarles puedes podria podrias decir dime saludo saludos'
  ).split(' '),
);
function keywords(question: string) {
  const seen = new Set<string>();
  return (
    question
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((word) => {
      const key = normalizeSourceTopic(word);
      if (
        word.length < 2 ||
        word.length > 40 ||
        stopwords.has(key) ||
        seen.has(key)
      )
        return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}
function coverage(fragment: KnowledgeFragment, words: string[]) {
  const tokens = normalizeSourceTopic(
    `${fragment.section} ${fragment.content}`,
  ).split(' ');
  const matched = words.filter((word) => {
    const key = normalizeSourceTopic(word);
    return tokens.some(
      (token) =>
        token === key ||
        (key.length >= 5 &&
          token.length >= 5 &&
          token.slice(0, 5) === key.slice(0, 5)),
    );
  });
  return matched.length / words.length;
}
const duplicateText = (s: string) =>
  s.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
function duplicate(a: KnowledgeFragment, b: KnowledgeFragment) {
  const left = duplicateText(a.content),
    right = duplicateText(b.content);
  return (
    a.chunk_id === b.chunk_id ||
    left === right ||
    (a.document_id === b.document_id &&
      a.version === b.version &&
      (left.includes(right) || right.includes(left)))
  );
}

export function createKnowledgeRetriever(
  deps: Dependencies,
): KnowledgeRetriever {
  return Object.freeze({
    async retrieve(input: KnowledgeRetrievalInput, expectedPlan?: SourcePlan) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new KnowledgeRetrievalError('INVALID_INPUT');
      const options = parsed.data;
      const now = deps.now?.() ?? new Date();
      const configuration = await deps.configuration();
      const plan = routeSources(configuration, {
        query: options.question,
        intent: options.intent,
        topics: options.topics,
      });
      // Caller-supplied authorization can only narrow the router's decision.
      if (options.allowedSourceIds) {
        const allowed = new Set(options.allowedSourceIds);
        plan.primarySources = plan.primarySources.filter((s) =>
          allowed.has(s.id),
        );
        plan.fallbackSources = plan.fallbackSources.filter((s) =>
          allowed.has(s.id),
        );
        if (
          !plan.primarySources.length &&
          !plan.fallbackSources.length &&
          plan.reason === 'MATCHED_RULES'
        )
          plan.reason = 'NO_AUTHORIZED_SOURCES';
      }
      if (expectedPlan && !sameSourcePlan(plan, expectedPlan))
        throw new KnowledgeRetrievalError('UNAVAILABLE');
      const words = keywords(options.question);
      const terms: string[] = [];
      for (const word of words) {
        if ([...terms, `"${word}"`].join(' OR ').length <= 300)
          terms.push(`"${word}"`);
      }
      let truncated = false;
      const requirements = assessEvidence({
        question: options.question,
        intent: options.intent,
        fragments: [],
        now,
      }).requirements;
      async function search(ids: string[]) {
        if (!terms.length || !ids.length) return [];
        const sources = [...plan.primarySources, ...plan.fallbackSources];
        const candidates = await deps.search({
          query: terms.join(' OR '),
          sourceIds: ids,
          revision: plan.revision,
          limit: retrievalLimits.candidatesPerSource,
          recipient: options.recipient ?? options.recipients?.[0],
        });
        if (
          candidates.length >
          Math.min(40, ids.length * retrievalLimits.candidatesPerSource)
        )
          throw new KnowledgeRetrievalError('UNAVAILABLE');
        const ranked = candidates
          .flatMap((candidate) => {
            const source = sources.find(
              (s) => s.id === candidate.source_id && ids.includes(s.id),
            );
            if (!source || plan.excludedSourceIds.includes(source.id))
              return [];
            const { rank, ...fields } = candidate;
            const fragment = knowledgeFragmentSchema.safeParse({
              ...fields,
              source_title: source.title,
              source_priority: source.priority,
            });
            if (
              !fragment.success ||
              !Number.isFinite(rank) ||
              rank <= 0 ||
              !audienceMatchesAll(
                fragment.data,
                options.recipient,
                options.recipients,
              )
            )
              return [];
            const overlap = coverage(fragment.data, words);
            if (!overlap) return [];
            if (
              requirements.length &&
              !requirements.some((r) =>
                evidenceTopicMatches(
                  r.question,
                  `${fragment.data.section} ${fragment.data.content}`,
                ),
              )
            )
              return [];
            return [
              {
                fragment: fragment.data,
                rank:
                  (rank * (0.5 + overlap * 0.5)) /
                  (1 + ids.indexOf(source.id) * 0.1),
                authority: ids.indexOf(source.id),
              },
            ];
          })
          .sort(
            (a, b) =>
              Number(
                knowledgeCurrency(
                  b.fragment,
                  now.toISOString().slice(0, 10),
                ) === 'CURRENT',
              ) -
                Number(
                  knowledgeCurrency(
                    a.fragment,
                    now.toISOString().slice(0, 10),
                  ) === 'CURRENT',
                ) ||
              b.rank - a.rank ||
              a.authority - b.authority ||
              Date.parse(b.fragment.document_updated_at) -
                Date.parse(a.fragment.document_updated_at) ||
              a.fragment.document_id.localeCompare(b.fragment.document_id) ||
              a.fragment.position - b.fragment.position,
          );
        return ranked;
      }
      function select(ranked: Awaited<ReturnType<typeof search>>) {
        // Inspect contradictions before deduplication and token limits; a
        // conflicting fragment just outside the final context still matters.
        const review = reviewKnowledge(
          ranked.map((r) => r.fragment),
          now,
        );
        const omitted = new Set(review.omitted.map((r) => r.reference_id));
        const eligible: KnowledgeFragment[] = [];
        for (const { fragment } of ranked) {
          if (
            !omitted.has(knowledgeReferenceId(fragment)) &&
            !eligible.some((other) => duplicate(fragment, other))
          )
            eligible.push(fragment);
        }
        // Reserve context for requested facts before filling it with matches
        // that cannot answer a missing requirement.
        const evidence = assessEvidence({
          question: options.question,
          intent: options.intent,
          fragments: eligible,
          now,
        });
        const required = new Set(
          evidence.requirements.flatMap((r) => {
            const fragment = eligible.find((f) =>
              r.referenceIds.includes(knowledgeReferenceId(f)),
            );
            return fragment ? [fragment] : [];
          }),
        );
        const selected: KnowledgeFragment[] = [];
        for (const fragment of [
          ...required,
          ...eligible.filter((f) => !required.has(f)),
        ]) {
          if (
            selected.length >= options.maxFragments ||
            knowledgeTokenUpperBound([...selected, fragment]) >
              options.maxContextTokens
          ) {
            truncated = true;
            continue;
          }
          selected.push(fragment);
        }
        return { matches: selected, review };
      }
      const primary = await search(plan.primarySources.map((s) => s.id));
      let selected = select(primary);
      const primarySufficiency = assessEvidence({
        question: options.question,
        intent: options.intent,
        fragments: selected.matches,
        now,
      });
      let usedFallback = false;
      // A lexical hit may still lack an amount, current validity or one of
      // the requested facts. Keep useful primary evidence when adding backup.
      if (
        plan.fallbackSources.length &&
        (!selected.matches.length ||
          primarySufficiency.status === 'NEEDS_HUMAN_INPUT') &&
        !evaluateKnowledgePolicy(selected.review).reasons.includes(
          'KNOWLEDGE_CONFLICT',
        )
      ) {
        usedFallback = true;
        const backup = await search(plan.fallbackSources.map((s) => s.id));
        selected = select([...primary, ...backup]);
      }
      // In particular, a prohibition added while querying must not leak a
      // result collected under the previous configuration to a model.
      await deps.assertRevision(plan.revision);
      const { matches, review } = selected;
      return {
        plan,
        matches,
        usedFallback,
        tokenUpperBound: knowledgeTokenUpperBound(matches),
        truncated,
        review,
        policy: evaluateKnowledgePolicy(review),
        sufficiency: assessEvidence({
          question: options.question,
          intent: options.intent,
          fragments: matches,
          now,
        }),
        allowPartialDrafts: configuration.allowPartialDrafts,
      };
    },
  });
}
