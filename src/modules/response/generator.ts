import type { TextGenerationClient } from '@/providers/contracts';
import { validateWritingProfile } from '@/modules/identity/writing-profile';
import {
  ResponseGenerationError,
  responseLimits,
  type GeneratedResponse,
  type ResponseGenerationInput,
  type ResponseGenerationResult,
  type ResponseGenerator,
  type ResponseWarning,
} from './contracts';
import {
  generatedResponseSchema,
  parseGeneratedResponse,
  parseResponseVerification,
  record,
  responseVerificationSchema,
} from './schema';
import {
  responseInstructions,
  responseVerificationInstructions,
} from './prompts';
import { detectReplyLanguage } from './language';
import {
  effectiveStylePreferences,
  renderStylePreference,
  violatesStylePreferences,
} from '@/modules/identity/style-preferences';

export type {
  ResponseGenerator,
  ResponseGenerationInput,
  ResponseGenerationResult,
} from './contracts';
export { ResponseGenerationError } from './contracts';
const normalize = (text: string) =>
  text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' &&
  !!value.trim() &&
  value.length <= limit &&
  !/\p{Cc}/u.test(value.replace(/[\t\r\n]/gu, ''));

function prepare(input: ResponseGenerationInput) {
  const conversation = input?.conversation;
  if (
    !record(conversation) ||
    conversation.schemaVersion !== 1 ||
    (conversation.subject !== null &&
      (typeof conversation.subject !== 'string' ||
        conversation.subject.length > 4096 ||
        /\p{Cc}/u.test(conversation.subject))) ||
    !Array.isArray(conversation.messages) ||
    !conversation.messages.length ||
    conversation.messages.length > responseLimits.messages ||
    conversation.messages.some(
      (message) =>
        !record(message) ||
        typeof message.speaker !== 'string' ||
        !/^(?:owner|participant_\d{1,2})$/.test(message.speaker) ||
        !text(message.text, 64 * 1024) ||
        typeof message.isTarget !== 'boolean',
    ) ||
    conversation.messages.filter((message) => message.isTarget).length !== 1 ||
    !conversation.messages.at(-1)!.isTarget ||
    conversation.messages.at(-1)!.speaker === 'owner' ||
    (input.styleExamples !== undefined &&
      (!Array.isArray(input.styleExamples) ||
        input.styleExamples.length > responseLimits.examples ||
        input.styleExamples.some(
          (example) =>
            !record(example) ||
            !text(example.text, responseLimits.exampleCharacters),
        ))) ||
    (input.userInstructions !== undefined &&
      (!Array.isArray(input.userInstructions) ||
        input.userInstructions.length > 5 ||
        !input.userInstructions.every((instruction) => text(instruction, 300))))
  )
    throw new ResponseGenerationError('INVALID_INPUT');
  const prepared = {
    conversation: {
      schemaVersion: 1,
      subject: conversation.subject,
      messages: conversation.messages.map((message) => ({
        speaker: message.speaker,
        text: message.text,
        isTarget: message.isTarget,
      })),
      style: conversation.style
        ? validateWritingProfile(conversation.style)
        : null,
    },
    styleExamples: (input.styleExamples ?? []).map((example) => ({
      text: example.text,
    })),
    stylePreferences: effectiveStylePreferences(
      input.stylePreferences,
      input.userInstructions,
    ),
  };
  const result = {
    ...prepared,
    userInstructions: prepared.stylePreferences.map(renderStylePreference),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > responseLimits.inputBytes)
    throw new ResponseGenerationError('INVALID_INPUT');
  return result;
}

// Verify literal citations and concrete values without trusting the model's own verdict.
function groundingIssue(
  candidate: GeneratedResponse,
  conversation: ReturnType<typeof prepare>['conversation'],
): ResponseWarning | null {
  const commitment =
    /\b(?:(?:we|i)\s+(?:can|will|shall|offer|provide|agree|accept|guarantee|promise)|podemos|ofrecemos|aceptamos|garantizamos|revisaremos|enviaremos|me comprometo|nos comprometemos|estoy disponible|estamos disponibles|nuestro equipo)\b/iu;
  for (const evidence of candidate.evidence) {
    const source = conversation.messages[evidence.messageIndex];
    if (
      !source ||
      !normalize(source.text).includes(normalize(evidence.quote)) ||
      !normalize(candidate.bodyText!).includes(normalize(evidence.claim))
    )
      return 'UNVERIFIED_EVIDENCE';
    if (source.speaker !== 'owner' && commitment.test(evidence.claim))
      return 'UNSUPPORTED_COMMITMENT';
  }
  for (const clause of candidate
    .bodyText!.split(/[.!?\n]+/u)
    .filter((part) => commitment.test(part))) {
    if (
      !candidate.evidence.some(
        (evidence) =>
          conversation.messages[evidence.messageIndex]?.speaker === 'owner' &&
          commitment.test(evidence.claim) &&
          normalize(clause).includes(normalize(evidence.claim)),
      )
    )
      return 'UNSUPPORTED_COMMITMENT';
  }
  const values = (value: string) =>
    (
      value.match(
        /https?:\/\/[^\s<>]+|www\.[^\s<>]+|[^\s<>@]+@[^\s<>@]+|\d+(?:[.,:/-]\d+)*(?:\s*[%€$])?/gu,
      ) ?? []
    ).map((token) => {
      const trimmed = token.replace(/[.,;!?)]*$/u, '').replace(/\s+/gu, '');
      return /^https?:|^www\./i.test(trimmed) ? trimmed : trimmed.toLowerCase();
    });
  const quoted = new Set(
    candidate.evidence.flatMap((evidence) => values(evidence.quote)),
  );
  if (values(candidate.bodyText!).some((value) => !quoted.has(value)))
    return 'UNSUPPORTED_FACT';
  return null;
}

export function createResponseGenerator(
  client: TextGenerationClient,
  options: { unpersonalizedEvaluation?: boolean } = {},
): ResponseGenerator {
  return Object.freeze({
    async generate(
      input: ResponseGenerationInput,
    ): Promise<ResponseGenerationResult> {
      const prepared = prepare(input);
      if (
        options.unpersonalizedEvaluation &&
        (prepared.conversation.style ||
          prepared.styleExamples.length ||
          prepared.stylePreferences.length)
      )
        throw new ResponseGenerationError('INVALID_INPUT');
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
      let inputTokens = 0,
        outputTokens = 0,
        modelCalls = 0;
      const result = (
        candidate: GeneratedResponse,
      ): ResponseGenerationResult => ({
        ...candidate,
        warnings: [
          ...new Set<ResponseWarning>([
            ...candidate.warnings,
            'HUMAN_REVIEW_REQUIRED',
          ]),
        ],
        inputTokens,
        outputTokens,
        modelCalls,
        examplesUsed: prepared.styleExamples.length,
      });
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
          ![1, 2].includes(generated.attempts ?? 1) ||
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
        if (!prepared.conversation.style && !options.unpersonalizedEvaluation)
          return result(abstain('STYLE_PROFILE_UNAVAILABLE', 'und'));
        const candidate = parseGeneratedResponse(
          await generate(
            options.unpersonalizedEvaluation
              ? responseInstructions +
                  '\nEvaluación sin personalización: no tienes perfil ni ejemplos del titular. Usa un tono neutro y el idioma objetivo, manteniendo todas las reglas de seguridad y verificación.'
              : responseInstructions,
            { ...prepared, replyTask },
            'generated_response_v1',
            generatedResponseSchema,
          ),
        );
        if (candidate.status !== 'READY') return result(candidate);
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
        const issue = groundingIssue(candidate, prepared.conversation);
        if (issue) return result(abstain(issue, candidate.language));
        const verification = parseResponseVerification(
          await generate(
            responseVerificationInstructions,
            {
              replyTask,
              conversation: { messages: prepared.conversation.messages },
              userInstructions: prepared.userInstructions,
              stylePreferences: prepared.stylePreferences,
              proposal: {
                bodyText: candidate.bodyText,
                language: candidate.language,
                evidence: candidate.evidence,
              },
            },
            'response_verification_v1',
            responseVerificationSchema,
          ),
        );
        if (verification.verdict !== 'SUPPORTED')
          return result({
            ...abstain('MISSING_INFORMATION', candidate.language),
            status: verification.verdict,
            missingInformation:
              verification.verdict === 'BLOCKED'
                ? []
                : [
                    'La propuesta necesita respaldo o una decisión del titular.',
                  ],
            warnings: verification.issues,
          });
        return result(candidate);
      } finally {
        prepared.conversation.messages.length = 0;
        prepared.styleExamples.length = 0;
        prepared.userInstructions.length = 0;
        prepared.stylePreferences.length = 0;
      }
    },
  });
}
