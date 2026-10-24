import {
  textGenerationAttemptLimit,
  type TextGenerationClient,
} from '@/providers/contracts';
import {
  ResponseGenerationError,
  type GeneratedResponse,
  type ResponseGenerationInput,
  type GenerateReplyResult,
  type ResponseGenerator,
  type ResponseWarning,
} from './contracts';
import {
  generatedResponseSchema,
  parseGeneratedResponse,
  parseResponseVerification,
  responseVerificationSchema,
} from './schema';
import {
  responseInstructions,
  responseVerificationInstructions,
} from './prompts';
import { detectReplyLanguage } from './language';
import { violatesStylePreferences } from '@/modules/identity/style-preferences';
import { knowledgeReference } from '@/modules/knowledge/provenance';
import { claimsMissingEvidence } from '@/modules/knowledge/sufficiency';
import {
  promptSecurityVersion,
  responseOutputHasInjection,
} from '@/modules/security/prompt-injection';

export type {
  GenerateReplyInput,
  GenerateReplyResult,
  ResponseGenerator,
  ResponseGenerationInput,
  ResponseGenerationResult,
} from './contracts';
export { ResponseGenerationError } from './contracts';
import { prepareGenerateReplyInput as prepare } from './context';
import { finalizeReplyResult } from './result';
import { createResponsePolicyEngine } from '@/modules/policy/response-policy';
import { applyResponsePolicy } from '@/modules/policy/policy-result';
import { parseGenerateReplyInput } from './input';
import {
  validateResponseFacts,
  factualWarning,
  rejectFactualValidation,
  applyFactualValidation,
  type FactualValidation,
} from './factual-validation';
export function createResponseGenerator(
  client: TextGenerationClient,
  options: { unpersonalizedEvaluation?: boolean } = {},
): ResponseGenerator {
  const generator = createBaseResponseGenerator(client, options);
  return Object.freeze({
    async generate(raw: ResponseGenerationInput): Promise<GenerateReplyResult> {
      const input = parseGenerateReplyInput(raw);
      const policy = createResponsePolicyEngine(input.responsePolicy);
      const before = policy.preflight(input);
      if (before.action !== 'ALLOW_DRAFT')
        return applyResponsePolicy(input, [before]);
      const response = applyFactualValidation(
        input,
        await generator.generate(input),
      );
      const after = policy.postflight(input, response);
      return applyResponsePolicy(input, [before, after], response);
    },
  });
}
function createBaseResponseGenerator(
  client: TextGenerationClient,
  options: { unpersonalizedEvaluation?: boolean } = {},
): ResponseGenerator {
  return Object.freeze({
    async generate(
      input: ResponseGenerationInput,
    ): Promise<GenerateReplyResult> {
      const prepared = prepare(input);
      if (
        options.unpersonalizedEvaluation &&
        (prepared.conversation.style ||
          prepared.styleExamples.length ||
          prepared.stylePreferences.length)
      )
        throw new ResponseGenerationError('INVALID_INPUT');
      const { historicalReferences, ...modelContext } = prepared;
      const modelKnowledge = prepared.knowledge.map(
        ({ audience_kind: _kind, audience_key: _key, ...fragment }) => {
          void _kind;
          void _key;
          return fragment;
        },
      );
      const target = prepared.conversation.messages.at(-1)!;
      const targetLanguage = detectReplyLanguage(target.text);
      const languagePreference = prepared.stylePreferences.find(
        (p) => p.key === 'language',
      )?.value;
      const expectedLanguage =
        languagePreference && languagePreference !== 'recipient'
          ? languagePreference
          : targetLanguage;
      const replyTask = {
        author: 'owner',
        recipient: target.speaker,
        targetLanguage: expectedLanguage ?? 'und',
      };
      let factualValidation: FactualValidation | undefined;
      let inputTokens = 0,
        outputTokens = 0,
        modelCalls = 0;
      const result = (candidate: GeneratedResponse): GenerateReplyResult =>
        finalizeReplyResult(
          {
            ...candidate,
            factualValidation,
            warnings: [
              ...new Set<ResponseWarning>([
                ...candidate.warnings,
                'HUMAN_REVIEW_REQUIRED',
                ...(candidate.status === 'PARTIAL'
                  ? ['MISSING_INFORMATION' as const]
                  : []),
              ]),
            ],
            inputTokens,
            outputTokens,
            modelCalls,
            examplesUsed: prepared.styleExamples.length,
            needsHumanInput:
              candidate.status === 'INSUFFICIENT_CONTEXT' ||
              candidate.status === 'PARTIAL' ||
              (candidate.status === 'BLOCKED' &&
                candidate.warnings.includes('HIGH_RISK')),
            evidenceSufficiency: prepared.evidenceSufficiency,
            knowledgeReferences: [
              ...new Set(
                candidate.evidence.flatMap((e) =>
                  'knowledgeIndex' in e ? [e.knowledgeIndex] : [],
                ),
              ),
            ].map((knowledgeIndex) => {
              const fragment = prepared.knowledge[knowledgeIndex];
              return {
                ...knowledgeReference(
                  fragment,
                  new Date().toISOString().slice(0, 10),
                ),
                knowledgeIndex,
                sourceId: fragment.source_id,
                documentId: fragment.document_id,
                version: fragment.version,
                chunkId: fragment.chunk_id,
              };
            }),
            knowledgePolicy: prepared.knowledgePolicy,
          },
          prepared.conversation.subject,
          historicalReferences,
        );
      const abstain = (
        warning: ResponseWarning,
        language: string,
      ): GeneratedResponse => ({
        status: 'INSUFFICIENT_CONTEXT',
        bodyText: null,
        language,
        missingInformation: [
          'Se necesita información o autorización suficiente para responder con seguridad.',
        ],
        evidence: [],
        warnings: [warning],
      });
      const generate = async (
        instructions: string,
        payload: unknown,
        name: string,
        schema: Record<string, unknown>,
      ) => {
        modelCalls++;
        const generated = await client.generate({
          instructions,
          input: JSON.stringify(payload),
          jsonSchema: { name, schema },
        });
        if (
          !Number.isInteger(generated.attempts ?? 1) ||
          (generated.attempts ?? 1) < 1 ||
          (generated.attempts ?? 1) > textGenerationAttemptLimit ||
          ![generated.inputTokens, generated.outputTokens].every(
            (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647,
          )
        )
          throw new ResponseGenerationError('INVALID_RESPONSE');
        inputTokens += generated.inputTokens;
        outputTokens += generated.outputTokens;
        modelCalls += (generated.attempts ?? 1) - 1;
        return generated.text;
      };
      try {
        if (prepared.knowledgePolicy.action === 'REVIEW_REQUIRED')
          return result(abstain(prepared.knowledgePolicy.reasons[0], 'und'));
        if (!prepared.conversation.style && !options.unpersonalizedEvaluation)
          return result(abstain('STYLE_PROFILE_UNAVAILABLE', 'und'));
        const missingEvidence =
          prepared.evidenceSufficiency.status === 'NEEDS_HUMAN_INPUT';
        const partialAllowed =
          prepared.allowPartialDrafts &&
          prepared.evidenceSufficiency.requirements.every(
            (r) =>
              ![
                'CALENDAR',
                'ORDER_STATUS',
                'OWNER_DECISION',
                'ATTACHMENT',
              ].includes(r.kind),
          );
        if (
          missingEvidence &&
          (!partialAllowed || !prepared.evidenceSufficiency.canPreparePartial)
        )
          return result({
            ...abstain('KNOWLEDGE_INSUFFICIENT', expectedLanguage ?? 'und'),
            missingInformation: prepared.evidenceSufficiency.missingInformation,
          });
        const candidate = parseGeneratedResponse(
          await generate(
            options.unpersonalizedEvaluation
              ? responseInstructions +
                  '\nEvaluación sin personalización: no tienes perfil ni ejemplos del titular. Usa un tono neutro y el idioma objetivo, manteniendo todas las reglas de seguridad y verificación.'
              : responseInstructions,
            {
              ...modelContext,
              knowledge: modelKnowledge,
              replyTask,
              security: {
                version: promptSecurityVersion,
                operation: 'PROPOSE_REPLY',
                tools: [],
              },
            },
            'generated_response_v1',
            generatedResponseSchema,
          ),
        );
        // Check the raw candidate before any factual/style sanitization and
        // before exposing it to the independent verifier.
        if (
          responseOutputHasInjection(candidate) ||
          candidate.warnings.includes('PROMPT_INJECTION')
        )
          return result({
            status: 'BLOCKED',
            bodyText: null,
            language: candidate.language,
            missingInformation: [],
            evidence: [],
            warnings: ['PROMPT_INJECTION'],
          });
        if (candidate.status !== 'READY' && candidate.status !== 'PARTIAL')
          return result(candidate);
        if (
          (candidate.status === 'PARTIAL' && !partialAllowed) ||
          (missingEvidence && candidate.status !== 'PARTIAL')
        )
          return result({
            ...abstain('KNOWLEDGE_INSUFFICIENT', candidate.language),
            missingInformation: prepared.evidenceSufficiency.missingInformation
              .length
              ? prepared.evidenceSufficiency.missingInformation
              : ['Se necesita completar la información de la propuesta.'],
          });
        if (candidate.status === 'PARTIAL')
          candidate.missingInformation = [
            ...new Set([
              ...prepared.evidenceSufficiency.missingInformation,
              ...candidate.missingInformation,
            ]),
          ].slice(0, 8);
        if (
          candidate.status === 'PARTIAL' &&
          claimsMissingEvidence(
            prepared.evidenceSufficiency,
            candidate.bodyText!,
          )
        ) {
          factualValidation = rejectFactualValidation(
            validateResponseFacts(input, candidate),
            'MISSING_EVIDENCE',
          );
          return result({
            ...abstain('UNSUPPORTED_FACT', candidate.language),
            missingInformation: prepared.evidenceSufficiency.missingInformation,
          });
        }
        if (
          violatesStylePreferences(
            candidate.bodyText!,
            prepared.stylePreferences,
          )
        )
          return result(
            abstain('STYLE_PREFERENCE_MISMATCH', candidate.language),
          );
        const bodyLanguage = detectReplyLanguage(candidate.bodyText!);
        const declaredLanguage = candidate.language.toLowerCase().split('-')[0];
        if (
          (bodyLanguage && bodyLanguage !== declaredLanguage) ||
          (expectedLanguage && expectedLanguage !== declaredLanguage)
        )
          return result(
            abstain(
              'LANGUAGE_MISMATCH',
              expectedLanguage ?? candidate.language,
            ),
          );
        factualValidation = validateResponseFacts(input, candidate);
        const issue =
          factualValidation.status === 'REVIEW_REQUIRED'
            ? factualWarning(factualValidation)
            : null;
        if (issue)
          return result({
            ...abstain(issue, candidate.language),
            missingInformation: factualValidation.missingInformation,
          });
        const verification = parseResponseVerification(
          await generate(
            responseVerificationInstructions,
            {
              security: {
                version: promptSecurityVersion,
                operation: 'VERIFY_REPLY',
                tools: [],
              },
              replyTask,
              conversation: { messages: prepared.conversation.messages },
              knowledge: modelKnowledge,
              allowEmailHistory: prepared.allowEmailHistory,
              knowledgeEvaluatedAt: prepared.knowledgeEvaluatedAt,
              evidenceSufficiency: prepared.evidenceSufficiency,
              allowPartialDrafts: partialAllowed,
              userInstructions: prepared.userInstructions,
              stylePreferences: prepared.stylePreferences,
              proposal: {
                status: candidate.status,
                missingInformation: candidate.missingInformation,
                bodyText: candidate.bodyText,
                language: candidate.language,
                evidence: candidate.evidence,
              },
            },
            'response_verification_v1',
            responseVerificationSchema,
          ),
        );
        if (verification.verdict !== 'SUPPORTED') {
          if (
            verification.issues.some((issue) =>
              [
                'UNSUPPORTED_FACT',
                'UNSUPPORTED_COMMITMENT',
                'MISSING_INFORMATION',
              ].includes(issue),
            )
          )
            factualValidation = rejectFactualValidation(factualValidation);
          return result({
            ...abstain('MISSING_INFORMATION', candidate.language),
            status: verification.verdict,
            missingInformation:
              verification.verdict === 'BLOCKED'
                ? []
                : factualValidation.missingInformation.length
                  ? factualValidation.missingInformation
                  : [
                      'La propuesta necesita respaldo o una decisión del titular.',
                    ],
            warnings: verification.issues,
          });
        }
        return result(candidate);
      } finally {
        prepared.conversation.messages.length = 0;
        prepared.historicalReferences.length = 0;
        prepared.styleExamples.length = 0;
        prepared.userInstructions.length = 0;
        prepared.stylePreferences.length = 0;
        prepared.knowledge.length = 0;
      }
    },
  });
}
