import { validateWritingProfile } from '@/modules/identity/writing-profile';
import {
  effectiveStylePreferences,
  renderStylePreference,
} from '@/modules/identity/style-preferences';
import {
  knowledgeTokenUpperBound,
  retrievalLimits,
} from '@/modules/knowledge/retriever';
import {
  reviewKnowledge,
  knowledgeReferenceId,
} from '@/modules/knowledge/provenance';
import { evaluateKnowledgePolicy } from '@/modules/policy/knowledge-policy';
import { assessEvidence } from '@/modules/knowledge/sufficiency';
import {
  ResponseGenerationError,
  responseLimits,
  type GenerateReplyInput,
} from './contracts';
import { parseGenerateReplyInput } from './input';

export function prepareGenerateReplyInput(raw: GenerateReplyInput) {
  const input = parseGenerateReplyInput(raw);
  const history = input.historicalContext ?? [];
  const conversation = {
    ...input.conversation,
    messages: [
      ...history.map(({ speaker, text }) => ({
        speaker,
        text,
        isTarget: false,
      })),
      ...input.conversation.messages,
    ],
  };
  const knowledge = { data: input.knowledge ?? [] };
  const suppliedPolicy = {
    data: input.knowledgePolicy ?? {
      action: 'ALLOW_DRAFT' as const,
      reasons: [],
    },
  };
  if (knowledgeTokenUpperBound(knowledge.data) > retrievalLimits.contextTokens)
    throw new ResponseGenerationError('INVALID_INPUT');
  const review = reviewKnowledge(knowledge.data);
  const omitted = new Set(review.omitted.map((r) => r.reference_id));
  const prepared = {
    historicalReferences: history.map((m) => m.referenceId),
    knowledge: knowledge.data.filter(
      (f) => !omitted.has(knowledgeReferenceId(f)),
    ),
    knowledgeEvaluatedAt: review.evaluated_at,
    allowPartialDrafts: input.allowPartialDrafts === true,
    allowEmailHistory: input.allowEmailHistory === true,
    evidenceSufficiency: assessEvidence({
      question: conversation.messages.at(-1)!.text,
      fragments: knowledge.data.filter(
        (f) => !omitted.has(knowledgeReferenceId(f)),
      ),
      ownerMessages: conversation.messages.flatMap((message, index) =>
        input.allowEmailHistory === true && message.speaker === 'owner'
          ? [{ text: message.text, index }]
          : [],
      ),
    }),
    knowledgePolicy:
      suppliedPolicy.data.action === 'REVIEW_REQUIRED'
        ? suppliedPolicy.data
        : evaluateKnowledgePolicy(review),
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
