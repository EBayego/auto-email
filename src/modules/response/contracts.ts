import type { WritingProfile } from '@/modules/identity/writing-profile';
import { textGenerationAttemptLimit } from '@/providers/contracts';
import type { StylePreference } from '@/modules/identity/style-preferences';
import type { KnowledgeFragment } from '@/modules/knowledge/retriever';
import type { KnowledgeReference } from '@/modules/knowledge/provenance';
import type { KnowledgePolicyResult } from '@/modules/policy/knowledge-policy';
import type { EvidenceSufficiency } from '@/modules/knowledge/sufficiency';
import type { ReplySource } from './sources';
import type {
  ResponsePolicyContext,
  ResponsePolicySettings,
  ResponsePolicyEvaluation,
} from '@/modules/policy/settings';

export type ResponseWarning =
  | 'HUMAN_REVIEW_REQUIRED'
  | 'MISSING_INFORMATION'
  | 'UNSUPPORTED_FACT'
  | 'UNSUPPORTED_COMMITMENT'
  | 'UNVERIFIED_EVIDENCE'
  | 'HIGH_RISK'
  | 'PROMPT_INJECTION'
  | 'NO_REPLY_REQUIRED'
  | 'LANGUAGE_MISMATCH'
  | 'UNANSWERED_QUESTION'
  | 'STYLE_PREFERENCE_MISMATCH'
  | 'STYLE_PROFILE_UNAVAILABLE'
  | 'KNOWLEDGE_CONFLICT'
  | 'KNOWLEDGE_NOT_CURRENT'
  | 'KNOWLEDGE_INSUFFICIENT'
  | 'POLICY_RESTRICTED';
export type ResponseEvidence = (
  { messageIndex: number } | { knowledgeIndex: number }
) & {
  quote: string;
  claim: string;
};
export type GeneratedResponse = {
  status: 'READY' | 'PARTIAL' | 'INSUFFICIENT_CONTEXT' | 'BLOCKED';
  bodyText: string | null;
  language: string;
  missingInformation: string[];
  evidence: ResponseEvidence[];
  warnings: ResponseWarning[];
};
export type GenerateReplyInput = {
  // Trusted routing context; excluded from both model payloads.
  recipient?: string;
  recipients?: readonly string[];
  messageAudiences?: readonly (readonly string[])[];
  conversation: {
    schemaVersion: 1;
    subject: string | null;
    messages: { speaker: string; text: string; isTarget: boolean }[];
    style: WritingProfile | null;
  };
  // References stay outside model input; history requires explicit permission.
  historicalContext?: readonly {
    referenceId: string;
    speaker: string;
    text: string;
    recipient?: string;
  }[];
  styleExamples?: readonly { text: string }[];
  userInstructions?: readonly string[];
  stylePreferences?: readonly StylePreference[];
  knowledge?: readonly KnowledgeFragment[];
  knowledgePolicy?: KnowledgePolicyResult;
  allowPartialDrafts?: boolean;
  allowEmailHistory?: boolean;
  responsePolicy?: ResponsePolicySettings;
  policyContext?: ResponsePolicyContext;
};
export type ResponseGenerationInput = GenerateReplyInput;
export type ResponseGenerationResult = GeneratedResponse & {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  examplesUsed: number;
  needsHumanInput?: boolean;
  evidenceSufficiency?: EvidenceSufficiency;
  knowledgeReferences?: (KnowledgeReference & {
    knowledgeIndex: number;
    sourceId: string;
    documentId: string;
    version: number;
    chunkId: string;
  })[];
  knowledgePolicy?: KnowledgePolicyResult;
  sourcesUsed?: ReplySource[];
  policyEvaluations?: ResponsePolicyEvaluation[];
  policyRevision?: string;
  knowledgeRevision?: string;
  factualValidation?: import('./factual-validation').FactualValidation;
};
export type GenerateReplyResult = ResponseGenerationResult & {
  schemaVersion: 1;
  email: { subject: string | null; bodyText: string } | null;
  evaluation: {
    language: string;
    needsHumanReview: true;
    needsHumanInput: boolean;
    missingInformation: string[];
    evidence: ResponseEvidence[];
    warnings: ResponseWarning[];
  };
  sourcesUsed: ReplySource[];
};
export interface ResponseGenerator {
  generate(input: GenerateReplyInput): Promise<GenerateReplyResult>;
}
export class ResponseGenerationError extends Error {
  constructor(
    public readonly code:
      'INVALID_INPUT' | 'INVALID_RESPONSE' | 'STYLE_PROFILE_REQUIRED',
  ) {
    super(code);
    this.name = 'ResponseGenerationError';
  }
}
export const responseLimits = Object.freeze({
  modelCalls: textGenerationAttemptLimit * 2,
  messages: 20,
  inputBytes: 96 * 1024,
  bodyCharacters: 6000,
  examples: 3,
  exampleCharacters: 2000,
});
