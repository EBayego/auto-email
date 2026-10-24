import type { GmailClient, TextGenerationClient } from '@/providers/contracts';

export const classificationDecisions = [
  'REPLY_REQUIRED',
  'NO_REPLY',
  'UNCERTAIN',
] as const;
export const classificationIntents = [
  'REQUEST_INFORMATION',
  'REQUEST_ACTION',
  'CONFIRMATION',
  'FOLLOW_UP',
  'MEETING',
  'COMPLAINT',
  'FINANCIAL',
  'LEGAL_CONTRACT',
  'NOTIFICATION',
  'UNKNOWN',
] as const;
export const classificationRisks = [
  'FINANCIAL',
  'LEGAL_CONTRACT',
  'SENSITIVE_DATA',
  'HUMAN_DECISION',
  'PROMPT_INJECTION',
  'GROUP_RECIPIENTS',
  'ATTACHMENT_REQUIRED',
] as const;
export const modelReasonCodes = [
  'EXPLICIT_QUESTION',
  'ACTION_REQUEST',
  'CONFIRMATION_REQUEST',
  'FOLLOW_UP_REQUEST',
  'INFORMATION_ONLY',
  'ACKNOWLEDGEMENT_ONLY',
  'AUTOMATED_NOTIFICATION',
  'NEWSLETTER_CONTENT',
  'NO_RESPONSE_EXPECTED',
  'INSUFFICIENT_CONTEXT',
  'AMBIGUOUS_INTENT',
  'HIGH_RISK',
  'PROMPT_INJECTION',
  'ATTACHMENT_REQUIRED',
] as const;
export type ClassificationReason =
  | (typeof modelReasonCodes)[number]
  | 'SPAM'
  | 'TRASH'
  | 'NOT_INCOMING'
  | 'EXCLUDED_SENDER'
  | 'EXCLUDED_DOMAIN'
  | 'NEWSLETTER'
  | 'AUTOREPLY'
  | 'AUTO_GENERATED'
  | 'NO_REPLY_ADDRESS'
  | 'AMBIGUOUS_HEADERS'
  | 'AMBIGUOUS_RECIPIENTS'
  | 'INVALID_MESSAGE'
  | 'MESSAGE_CHANGED'
  | 'INCOMPLETE_CONTENT'
  | 'EMPTY_CONTENT'
  | 'CONTENT_LIMIT_EXCEEDED'
  | 'MODEL_UNAVAILABLE'
  | 'INVALID_MODEL_RESPONSE'
  | 'LOW_CONFIDENCE';
export type ClassifierExclusions = Readonly<{
  excludedAddresses?: readonly string[];
  excludedDomains?: readonly string[];
}>;
export type ResolvedClassifierExclusions = Readonly<{
  excludedAddresses: readonly string[];
  excludedDomains: readonly string[];
}>;
export type EmailClassification = Readonly<{
  decision: (typeof classificationDecisions)[number];
  intent: (typeof classificationIntents)[number];
  reasons: readonly ClassificationReason[];
  explanation: string;
  riskFlags: readonly (typeof classificationRisks)[number][];
  needsAttachment: boolean;
  source: 'RULE' | 'MODEL';
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
}>;
export type ClassifyEmailInput = Readonly<{
  messageId: string;
  mailboxAddress: string;
  exclusions?: ClassifierExclusions;
}>;
export interface EmailClassifier {
  classify(input: ClassifyEmailInput): Promise<EmailClassification>;
}
export type ClassifierDependencies = {
  gmail: Pick<GmailClient, 'getMessage'>;
  text: TextGenerationClient;
  propagateProviderErrors?: boolean;
};
export class EmailClassificationError extends Error {
  constructor(readonly code: 'INVALID_INPUT') {
    super(code);
    this.name = 'EmailClassificationError';
  }
}
export const classifierLimits = Object.freeze({
  exclusions: 100,
  subjectCharacters: 1024,
  bodyCharacters: 12000,
});
