import type {
  GmailClient,
  GmailMessage,
  TextGenerationClient,
} from '@/providers/contracts';
import {
  selectPendingEmail,
  type PreparedReplyContext,
} from '@/modules/gmail/manual-selection';
import { createResponseGenerator } from '@/modules/response/generator';
import { responsePromptVersion } from '@/modules/response/prompts';
import {
  analyzeWriting,
  writingPromptVersion,
} from '@/modules/identity/analyze-writing';
import {
  groupContextualSamples,
  relationshipFor,
  type RelationshipRule,
} from '@/modules/identity/contextual-style';
import {
  createStyleExampleRetriever,
  styleExampleLimits,
} from '@/modules/identity/style-example-retriever';
import {
  resolveStylePreferences,
  type StoredStylePreference,
  type StylePreference,
} from '@/modules/identity/style-preferences';
import type { ResponseWarning } from '@/modules/response/contracts';
import {
  blindOrder,
  evaluationFingerprint,
  evaluationModes,
  identityMvpPolicy,
  measureStyle,
  StyleEvaluationError,
  validateEvaluationCorpus,
  validateHumanStyleRating,
  type EvaluationMode,
  type HumanStyleRating,
  type StyleEvaluationCorpus,
} from '@/modules/identity/style-evaluation';
import { summarizeStyleEvaluation } from './style-evaluation-summary';
import {
  judgeStyleCandidates,
  styleJudgeVersion,
  type AutomaticStyleRating,
} from '@/modules/identity/style-evaluation-judge';
import {
  loadHistoricalStyleCase,
  withEvaluationTraining,
  type EvaluationIdentity,
  type HistoricalStyleCase,
} from './style-evaluation-corpus';

export type StyleVariantResult = {
  mode: EvaluationMode;
  effectiveScope: string;
  profileFingerprint: string | null;
  status: string;
  examplesUsed: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  proxies: ReturnType<typeof measureStyle> | null;
  human: HumanStyleRating | null;
  automatic?: AutomaticStyleRating | null;
  warnings?: readonly ResponseWarning[];
};
export type StyleCaseResult = {
  caseId: string;
  humanReviewPerformed: boolean;
  appliedPreferences?: StylePreference[];
  variants: StyleVariantResult[];
};
export type BlindStyleCase = {
  caseId: string;
  incoming: string;
  conversation: PreparedReplyContext['modelInput']['messages'];
  referenceReply: string;
  candidates: { label: string; status: string; bodyText: string | null }[];
};
export async function evaluateHistoricalStyle(input: {
  gmail: Pick<GmailClient, 'getThread' | 'getMessage' | 'listMessages'>;
  text: TextGenerationClient;
  identity: EvaluationIdentity;
  corpus: StyleEvaluationCorpus;
  model: string;
  rules?: readonly RelationshipRule[];
  examples?: number;
  preferences?: readonly StoredStylePreference[];
  now?: Date;
  review?: (item: BlindStyleCase) => Promise<Record<string, HumanStyleRating>>;
  automaticReview?: boolean;
  progress?: (value: { completedCases: number; totalCases: number }) => void;
}) {
  const now = input.now ?? new Date();
  const corpus = validateEvaluationCorpus(input.corpus, input.identity, now);
  if (input.preferences)
    resolveStylePreferences(
      input.preferences,
      input.identity.mailboxAddress,
      input.rules ?? [],
    );
  const examplesLimit = input.examples ?? 3;
  if (
    (input.automaticReview && input.review) ||
    !Number.isInteger(examplesLimit) ||
    examplesLimit < 0 ||
    examplesLimit > 3 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.model)
  )
    throw new StyleEvaluationError('INVALID_EVALUATION');
  const historical: HistoricalStyleCase[] = [];
  const metadataCache = new Map<string, Promise<GmailMessage>>();
  const cases: StyleCaseResult[] = [];
  let analysisCalls = 0,
    analysisInputTokens = 0,
    analysisOutputTokens = 0,
    trainingMessages = 0;
  const automaticEvaluator = input.automaticReview
    ? {
        version: styleJudgeVersion,
        model: input.model,
        independence: 'SEPARATE_CALL_SAME_MODEL' as const,
        calibration: 'NOT_HUMAN_CALIBRATED' as const,
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
    : null;
  try {
    for (const reference of corpus.cases)
      historical.push(
        await loadHistoricalStyleCase(
          input.gmail,
          reference,
          input.identity,
          new Date(corpus.createdAt),
        ),
      );
    const cutoff = new Date(
      Math.min(...historical.map((item) => Date.parse(item.targetAt))),
    );
    const heldThreads = new Set(corpus.cases.map((item) => item.threadId));
    const heldIds = new Set(
      corpus.cases.flatMap((item) => [
        item.targetMessageId,
        item.replyMessageId,
      ]),
    );
    // The sampler revalidates authorship; the adapter enforces holdout isolation
    // even if Gmail returns stale or forged references with another thread ID.
    const isolated = {
      async getMessage(
        id: string,
        options?: Parameters<GmailClient['getMessage']>[1],
      ) {
        if (heldIds.has(id))
          throw new StyleEvaluationError('CONTAMINATED_HOLDOUT');
        const key = JSON.stringify([id, options?.metadataHeaders ?? []]);
        let pending =
          options?.format === 'metadata' ? metadataCache.get(key) : undefined;
        if (!pending) {
          pending = input.gmail.getMessage(id, options);
          if (options?.format === 'metadata') metadataCache.set(key, pending);
        }
        const message = await pending;
        if (heldThreads.has(message.threadId))
          throw new StyleEvaluationError('CONTAMINATED_HOLDOUT');
        return message;
      },
      async listMessages(options?: Parameters<GmailClient['listMessages']>[0]) {
        const page = await input.gmail.listMessages(options);
        return {
          ...page,
          messages: page.messages.filter(
            (ref) => !heldThreads.has(ref.threadId) && !heldIds.has(ref.id),
          ),
        };
      },
    };
    await withEvaluationTraining(
      isolated,
      corpus,
      input.identity,
      cutoff,
      async (messages) => {
        trainingMessages = messages.length;
        const analyze = async (
          source: Parameters<typeof analyzeWriting>[1],
        ) => {
          analysisCalls++;
          const result = await analyzeWriting(input.text, source);
          analysisCalls += (result.modelCalls ?? 1) - 1;
          analysisInputTokens += result.inputTokens;
          analysisOutputTokens += result.outputTokens;
          return result.profile;
        };
        const general = await analyze(messages);
        const rules = input.rules ?? [];
        const wanted = new Set(
          historical.flatMap((item) => [
            JSON.stringify(['RECIPIENT', item.recipient]),
            JSON.stringify(['DOMAIN', item.recipient.split('@')[1]]),
            JSON.stringify([
              'RELATIONSHIP',
              relationshipFor(item.recipient, rules),
            ]),
          ]),
        );
        const groups = groupContextualSamples(messages, rules).filter((group) =>
          wanted.has(JSON.stringify([group.scope.kind, group.scope.key])),
        );
        const contextual = new Map<string, typeof general>();
        try {
          for (const group of groups)
            contextual.set(
              JSON.stringify([group.scope.kind, group.scope.key]),
              await analyze(group.messages),
            );
          // Execute the arms in a stable shuffled order as well as blinding display.
          for (const [index, item] of historical.entries()) {
            const caseId = `case-${String(index + 1).padStart(2, '0')}`;
            const order = blindOrder(corpus.seed, caseId);
            const category = relationshipFor(item.recipient, rules);
            const preferences = resolveStylePreferences(
              input.preferences ?? [],
              item.recipient,
              rules,
            ).preferences;
            const contextKeys = [
              ['RECIPIENT', item.recipient],
              ['RELATIONSHIP', category],
              ['DOMAIN', item.recipient.split('@')[1]],
            ];
            const contextKey = contextKeys.find((key) =>
              contextual.has(JSON.stringify(key)),
            );
            const selected = contextKey
              ? contextual.get(JSON.stringify(contextKey))!
              : general;
            const transient: {
              mode: EvaluationMode;
              result: StyleVariantResult;
              bodyText: string | null;
            }[] = [];
            const caseResult: StyleCaseResult = {
              caseId,
              humanReviewPerformed: false,
              appliedPreferences: preferences,
              variants: [],
            };
            let prepared: PreparedReplyContext | undefined;
            const selection = await selectPendingEmail(
              { getThread: async () => item.thread },
              {
                accountId: input.identity.gmailAccountId,
                mailboxAddress: input.identity.mailboxAddress,
                aliases: input.identity.aliases,
                threadId: item.reference.threadId,
                targetMessageId: item.reference.targetMessageId,
              },
              async (context) => {
                prepared = context;
                try {
                  for (const mode of order) {
                    const profile =
                      mode === 'UNPERSONALIZED'
                        ? null
                        : mode === 'GENERAL'
                          ? general
                          : selected;
                    const retriever = createStyleExampleRetriever({
                      gmail: isolated,
                      sourceReferences: messages.map(({ id, threadId }) => ({
                        id,
                        threadId,
                      })),
                      identity: {
                        accountId: input.identity.gmailAccountId,
                        mailboxAddress: input.identity.mailboxAddress,
                        aliases: input.identity.aliases,
                      },
                    });
                    const examples =
                      mode === 'UNPERSONALIZED' || !examplesLimit
                        ? []
                        : await retriever.retrieve({
                            accountId: input.identity.gmailAccountId,
                            recipient: item.recipient,
                            threadId: item.reference.threadId,
                            subject: context.modelInput.subject,
                            text: context.modelInput.messages.find(
                              (m) => m.isTarget,
                            )!.text,
                            before: new Date(item.targetAt),
                            profile,
                            language: preferences.find(
                              (p) =>
                                p.key === 'language' && p.value !== 'recipient',
                            )?.value,
                            now,
                            limit: examplesLimit,
                          });
                    try {
                      const response = await createResponseGenerator(
                        input.text,
                        { unpersonalizedEvaluation: mode === 'UNPERSONALIZED' },
                      ).generate({
                        conversation: { ...context.modelInput, style: profile },
                        styleExamples: examples,
                        stylePreferences:
                          mode === 'UNPERSONALIZED' ? [] : preferences,
                      });
                      const result: StyleVariantResult = {
                        mode,
                        effectiveScope:
                          mode === 'UNPERSONALIZED'
                            ? 'NONE'
                            : mode === 'GENERAL' || !contextKey
                              ? 'GENERAL'
                              : contextKey[0]!,
                        profileFingerprint: profile
                          ? evaluationFingerprint(profile)
                          : null,
                        status: response.status,
                        examplesUsed: response.examplesUsed,
                        modelCalls: response.modelCalls,
                        inputTokens: response.inputTokens,
                        outputTokens: response.outputTokens,
                        proxies: response.bodyText
                          ? measureStyle(item.authoredReply, response.bodyText)
                          : null,
                        human: null,
                        automatic: null,
                        warnings: response.warnings,
                      };
                      transient.push({
                        mode,
                        result,
                        bodyText: response.bodyText,
                      });
                    } finally {
                      examples.length = 0;
                    }
                  }
                  if (input.review || input.automaticReview) {
                    const blind: BlindStyleCase = {
                      caseId,
                      incoming: context.modelInput.messages.find(
                        (m) => m.isTarget,
                      )!.text,
                      conversation: context.modelInput.messages.map(
                        (message) => ({ ...message }),
                      ),
                      referenceReply: item.authoredReply,
                      candidates: transient.map((variant, i) => ({
                        label: String.fromCharCode(65 + i),
                        status: variant.result.status,
                        bodyText: variant.bodyText,
                      })),
                    };
                    try {
                      const judged = input.automaticReview
                        ? await judgeStyleCandidates(input.text, blind)
                        : null;
                      if (judged && automaticEvaluator) {
                        automaticEvaluator.modelCalls += judged.modelCalls;
                        automaticEvaluator.inputTokens += judged.inputTokens;
                        automaticEvaluator.outputTokens += judged.outputTokens;
                      }
                      const ratings =
                        judged?.ratings ?? (await input.review!(blind));
                      const expectedLabels = blind.candidates
                        .filter((c) => c.status === 'READY')
                        .map((c) => c.label)
                        .sort();
                      if (
                        !ratings ||
                        JSON.stringify(Object.keys(ratings).sort()) !==
                          JSON.stringify(expectedLabels)
                      )
                        throw new StyleEvaluationError('INCOMPLETE_REVIEW');
                      transient.forEach((variant, i) => {
                        const label = String.fromCharCode(65 + i);
                        if (variant.result.status === 'READY' && judged)
                          variant.result.automatic = judged.ratings[label];
                        else if (variant.result.status === 'READY')
                          variant.result.human = validateHumanStyleRating(
                            ratings[label],
                          );
                      });
                      caseResult.humanReviewPerformed = !judged;
                    } finally {
                      blind.incoming = '';
                      blind.conversation.length = 0;
                      blind.referenceReply = '';
                      blind.candidates.length = 0;
                    }
                  }
                  caseResult.variants = evaluationModes.map(
                    (mode) =>
                      transient.find((variant) => variant.mode === mode)!
                        .result,
                  );
                } finally {
                  transient.forEach((v) => {
                    v.bodyText = null;
                  });
                  transient.length = 0;
                }
              },
            );
            if (!selection.contextPrepared || !prepared) {
              caseResult.variants = evaluationModes.map((mode) => ({
                mode,
                effectiveScope: 'UNAVAILABLE',
                profileFingerprint: null,
                status: selection.status,
                examplesUsed: 0,
                modelCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
                proxies: null,
                human: null,
              }));
            }
            cases.push(caseResult);
            input.progress?.({
              completedCases: cases.length,
              totalCases: historical.length,
            });
          }
        } finally {
          for (const group of groups) group.messages.length = 0;
          contextual.clear();
        }
      },
      now,
    );
    return {
      version: 1 as const,
      corpusFingerprint: evaluationFingerprint(corpus),
      configurationFingerprint: evaluationFingerprint({
        model: input.model,
        examples: examplesLimit,
        rules: input.rules ?? [],
        aliases: [...(input.identity.aliases ?? [])]
          .map((s) => s.toLowerCase())
          .sort(),
        responsePromptVersion,
        writingPromptVersion,
        automaticReview: input.automaticReview ?? false,
        styleJudgeVersion: input.automaticReview ? styleJudgeVersion : null,
        preferences: input.preferences ?? [],
        exampleSelectionVersion: styleExampleLimits.version,
      }),
      model: input.model,
      promptVersion: responsePromptVersion,
      baselinePromptVersion: 'mail028-baseline-v1',
      profilePromptVersion: writingPromptVersion,
      trainingMessages,
      analysisCalls,
      analysisInputTokens,
      analysisOutputTokens,
      automaticEvaluator,
      personalizationPreferences: input.preferences?.length
        ? ('EXPLICIT_IN_PERSONALIZED_VARIANTS' as const)
        : ('EXCLUDED_FOR_CONTROLLED_COMPARISON' as const),
      preferenceFingerprint: evaluationFingerprint(input.preferences ?? []),
      mvpPolicy: identityMvpPolicy,
      cases,
      summary: summarizeStyleEvaluation(cases),
    };
  } finally {
    metadataCache.clear();
    historical.forEach((item) => {
      item.authoredReply = '';
      item.thread = { id: item.reference.threadId, messages: [] };
    });
    historical.length = 0;
  }
}
