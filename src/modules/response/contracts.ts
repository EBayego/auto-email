import type { PreparedReplyContext } from '@/modules/gmail/manual-selection';
import type { StylePreference } from '@/modules/identity/style-preferences';

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
  | 'STYLE_PROFILE_UNAVAILABLE';
export type ResponseEvidence = {
  messageIndex: number;
  quote: string;
  claim: string;
};
export type GeneratedResponse = {
  status: 'READY' | 'INSUFFICIENT_CONTEXT' | 'BLOCKED';
  bodyText: string | null;
  language: string;
  missingInformation: string[];
  evidence: ResponseEvidence[];
  warnings: ResponseWarning[];
};
export type ResponseGenerationInput = {
  conversation: PreparedReplyContext['modelInput'];
  styleExamples?: readonly { text: string }[];
  userInstructions?: readonly string[];
  stylePreferences?: readonly StylePreference[];
};
export type ResponseGenerationResult = GeneratedResponse & {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  examplesUsed: number;
};
export interface ResponseGenerator {
  generate(input: ResponseGenerationInput): Promise<ResponseGenerationResult>;
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
  messages: 20,
  inputBytes: 96 * 1024,
  bodyCharacters: 6000,
  examples: 3,
  exampleCharacters: 2000,
});
