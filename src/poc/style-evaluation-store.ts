import {
  mkdir,
  lstat,
  readFile,
  writeFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { responseLimits } from '@/modules/response/contracts';
import {
  evaluationFingerprint,
  evaluationModes,
  identityMvpPolicy,
  StyleEvaluationError,
  validateEvaluationCorpus,
  validateHumanStyleRating,
  type StyleEvaluationCorpus,
} from '@/modules/identity/style-evaluation';
import { summarizeStyleEvaluation } from './style-evaluation-summary';
import { stylePreferenceSchema } from '@/modules/identity/style-preferences';
import { modelWarnings } from '@/modules/response/schema';
import {
  automaticStyleRatingSchema,
  validateAutomaticStyleRating,
  styleJudgeVersion,
} from '@/modules/identity/style-evaluation-judge';
import type {
  evaluateHistoricalStyle,
  StyleCaseResult,
} from './evaluate-style';

type Report = Awaited<ReturnType<typeof evaluateHistoricalStyle>>;
type Owner = { userId: string; gmailAccountId: string };
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.int().min(0).max(100000000);
const proxies = z.strictObject({
  greetingMatch: z.boolean(),
  formalityMatch: z.boolean().nullable(),
  vocabularyJaccard: z.number().min(0).max(1).nullable(),
  referenceWords: count,
  candidateWords: count,
  lengthRatio: z.number().min(0).max(100000).nullable(),
  languageMatch: z.boolean().nullable(),
});
const reportSchema = z.strictObject({
  version: z.literal(1),
  corpusFingerprint: fingerprint,
  configurationFingerprint: fingerprint,
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  promptVersion: z.string().max(64),
  baselinePromptVersion: z.literal('mail028-baseline-v1'),
  profilePromptVersion: z.string().max(64),
  trainingMessages: count,
  analysisCalls: count,
  analysisInputTokens: count,
  analysisOutputTokens: count,
  personalizationPreferences: z
    .enum([
      'EXCLUDED_FOR_CONTROLLED_COMPARISON',
      'EXPLICIT_IN_PERSONALIZED_VARIANTS',
    ])
    .optional(),
  preferenceFingerprint: fingerprint.optional(),
  automaticEvaluator: z
    .strictObject({
      version: z.literal(styleJudgeVersion),
      model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
      independence: z.literal('SEPARATE_CALL_SAME_MODEL'),
      calibration: z.literal('NOT_HUMAN_CALIBRATED'),
      modelCalls: z.int().min(0).max(40),
      inputTokens: count,
      outputTokens: count,
    })
    .nullable()
    .optional(),
  cases: z
    .array(
      z.strictObject({
        caseId: z.string().regex(/^case-\d{2}$/),
        humanReviewPerformed: z.boolean(),
        appliedPreferences: z.array(stylePreferenceSchema).max(8).optional(),
        variants: z
          .array(
            z.strictObject({
              mode: z.enum(evaluationModes),
              effectiveScope: z.enum([
                'NONE',
                'GENERAL',
                'RECIPIENT',
                'DOMAIN',
                'RELATIONSHIP',
                'UNAVAILABLE',
              ]),
              profileFingerprint: fingerprint.nullable(),
              status: z.string().regex(/^[A-Z_]{1,40}$/),
              examplesUsed: z.int().min(0).max(3),
              modelCalls: z.int().min(0).max(responseLimits.modelCalls),
              inputTokens: count,
              outputTokens: count,
              proxies: proxies.nullable(),
              human: z.unknown(),
              automatic: automaticStyleRatingSchema.nullable().optional(),
              warnings: z
                .array(
                  z.enum([
                    ...modelWarnings,
                    'HUMAN_REVIEW_REQUIRED',
                    'UNVERIFIED_EVIDENCE',
                    'STYLE_PROFILE_UNAVAILABLE',
                  ]),
                )
                .max(15)
                .optional(),
            }),
          )
          .length(3),
      }),
    )
    .min(10)
    .max(20),
});
export function createStyleEvaluationStore(directory: string) {
  const stem = (owner: Owner) => {
    if (
      !z.uuid().safeParse(owner.userId).success ||
      !z.uuid().safeParse(owner.gmailAccountId).success
    )
      throw new StyleEvaluationError('ACCOUNT_MISMATCH');
    return join(directory, `${owner.userId}_${owner.gmailAccountId}`);
  };
  const remove = async (path: string) => {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  };
  const read = async (path: string) => {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new StyleEvaluationError('INVALID_EVALUATION');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const write = async (path: string, value: unknown) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temp, path);
    } finally {
      await remove(temp);
    }
  };
  const loadCorpus = async (owner: Owner, now: Date) => {
    const base = stem(owner);
    try {
      return validateEvaluationCorpus(
        await read(base + '.corpus.json'),
        owner,
        now,
      );
    } catch (error) {
      if (
        error instanceof StyleEvaluationError &&
        error.code === 'EXPIRED_EVALUATION'
      ) {
        await remove(base + '.corpus.json');
        await remove(base + '.report.json');
      }
      throw error;
    }
  };
  return Object.freeze({
    async saveCorpus(
      owner: Owner,
      value: StyleEvaluationCorpus,
      now = new Date(),
    ) {
      const corpus = validateEvaluationCorpus(value, owner, now);
      await write(stem(owner) + '.corpus.json', corpus);
      await remove(stem(owner) + '.report.json');
    },
    async loadCorpus(
      owner: Owner,
      now = new Date(),
    ): Promise<StyleEvaluationCorpus> {
      return loadCorpus(owner, now);
    },
    async saveReport(owner: Owner, report: Report, now = new Date()) {
      const corpus = await loadCorpus(owner, now);
      // Allowlist every level so raw examples, references, prompts or bodies can
      // never be added to saved reports by a future caller extending runtime DTOs.
      if (report.corpusFingerprint !== evaluationFingerprint(corpus))
        throw new StyleEvaluationError('INVALID_EVALUATION');
      const data = reportSchema.parse({
        version: 1,
        corpusFingerprint: report.corpusFingerprint,
        configurationFingerprint: report.configurationFingerprint,
        model: report.model,
        promptVersion: report.promptVersion,
        baselinePromptVersion: report.baselinePromptVersion,
        profilePromptVersion: report.profilePromptVersion,
        trainingMessages: report.trainingMessages,
        analysisCalls: report.analysisCalls,
        analysisInputTokens: report.analysisInputTokens,
        analysisOutputTokens: report.analysisOutputTokens,
        personalizationPreferences: report.personalizationPreferences,
        preferenceFingerprint: report.preferenceFingerprint,
        automaticEvaluator: report.automaticEvaluator
          ? {
              version: report.automaticEvaluator.version,
              model: report.automaticEvaluator.model,
              independence: report.automaticEvaluator.independence,
              calibration: report.automaticEvaluator.calibration,
              modelCalls: report.automaticEvaluator.modelCalls,
              inputTokens: report.automaticEvaluator.inputTokens,
              outputTokens: report.automaticEvaluator.outputTokens,
            }
          : null,
        cases: report.cases.map((item) => ({
          caseId: item.caseId,
          humanReviewPerformed: item.humanReviewPerformed,
          appliedPreferences: item.appliedPreferences,
          variants: item.variants.map((v) => ({
            mode: v.mode,
            effectiveScope: v.effectiveScope,
            profileFingerprint: v.profileFingerprint,
            status: v.status,
            warnings: v.warnings ? [...v.warnings] : [],
            examplesUsed: v.examplesUsed,
            modelCalls: v.modelCalls,
            inputTokens: v.inputTokens,
            outputTokens: v.outputTokens,
            proxies: v.proxies ? proxies.parse(v.proxies) : null,
            human: v.human ? validateHumanStyleRating(v.human) : null,
            automatic: v.automatic
              ? validateAutomaticStyleRating(v.automatic)
              : null,
          })),
        })),
      });
      await write(stem(owner) + '.report.json', data);
    },
    async loadReport(owner: Owner, now = new Date()) {
      const corpus = await loadCorpus(owner, now);
      const report = reportSchema.parse(
        await read(stem(owner) + '.report.json'),
      );
      if (report.corpusFingerprint !== evaluationFingerprint(corpus))
        throw new StyleEvaluationError('INVALID_EVALUATION');
      const cases: StyleCaseResult[] = report.cases.map((item) => ({
        ...item,
        variants: item.variants.map((v) => ({
          ...v,
          human: v.human ? validateHumanStyleRating(v.human) : null,
          automatic: v.automatic
            ? validateAutomaticStyleRating(v.automatic)
            : null,
        })),
      }));
      return {
        ...report,
        cases,
        summary: summarizeStyleEvaluation(cases),
        mvpPolicy: identityMvpPolicy,
        personalizationPreferences:
          report.personalizationPreferences ??
          'EXCLUDED_FOR_CONTROLLED_COMPARISON',
      };
    },
    async remove(owner: Owner) {
      await remove(stem(owner) + '.corpus.json');
      await remove(stem(owner) + '.report.json');
    },
  });
}
