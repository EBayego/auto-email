import type { SecretValue } from '@/config/env';

// At most two structured-output attempts, each with up to five transport
// attempts from the worker's request policy. This counts actual API requests.
export const textGenerationAttemptLimit = 10;

export type TextGenerationInput = {
  instructions: string;
  input: string;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};
export type TextGenerationResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  attempts?: number;
};
export interface TextGenerationClient {
  generate(input: TextGenerationInput): Promise<TextGenerationResult>;
}

export type GmailReadResource =
  | 'profile'
  | 'messages'
  | 'drafts'
  | `messages/${string}`
  | `threads/${string}`
  | `drafts/${string}`;
export type GmailQuery = Readonly<
  Record<string, string | number | boolean | readonly string[]>
>;
export type GmailListOptions = {
  mailbox?: 'inbox' | 'sent' | 'all' | 'incoming';
  labelIds?: readonly string[];
  after?: Date;
  before?: Date;
  from?: string;
  to?: string;
  textTerms?: readonly string[];
  unread?: boolean;
  maxResults?: number;
  pageToken?: string;
};
export type GmailMessageReference = Readonly<{ id: string; threadId: string }>;
export type GmailMessagePage = Readonly<{
  messages: readonly GmailMessageReference[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}>;
export type GmailMessageFormat = 'minimal' | 'metadata' | 'full' | 'raw';
export type GmailGetOptions = {
  format?: GmailMessageFormat;
  metadataHeaders?: readonly string[];
};
export type GmailThreadOptions = {
  format?: Exclude<GmailMessageFormat, 'raw'>;
  metadataHeaders?: readonly string[];
};
export type GmailThread = Readonly<{
  id: string;
  historyId?: string;
  messages: readonly GmailMessage[];
}>;
export type GmailMessagePart = Readonly<{
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: readonly Readonly<{ name: string; value: string }>[];
  body?: Readonly<{ size?: number; data?: string; attachmentId?: string }>;
  parts?: readonly GmailMessagePart[];
}>;
export type GmailMessage = GmailMessageReference &
  Readonly<{
    labelIds?: readonly string[];
    snippet?: string;
    historyId?: string;
    internalDate?: string;
    sizeEstimate?: number;
    payload?: GmailMessagePart;
    raw?: string;
  }>;
export interface GmailTransport {
  get(resource: GmailReadResource, query?: GmailQuery): Promise<unknown>;
  createDraft(
    message: { raw: string; threadId?: string },
    guard?: GmailDraftGuard,
  ): Promise<unknown>;
}
export type GmailDraftGuard = Readonly<{
  // Repeated before acquiring a write permit, including after quota waits.
  prepare(): Promise<void>;
  // Runs with the permit held, immediately before the irreversible HTTP call.
  beforeRequest(): Promise<void>;
}>;
export interface GmailClient extends GmailTransport {
  listMessages(options?: GmailListOptions): Promise<GmailMessagePage>;
  getMessage(id: string, options?: GmailGetOptions): Promise<GmailMessage>;
  getThread(id: string, options?: GmailThreadOptions): Promise<GmailThread>;
}
export type AccessTokenProvider = () => Promise<string>;
export type GoogleTokenSet = {
  accessToken: SecretValue;
  refreshToken: SecretValue | null;
  scopes: readonly string[] | null;
  expiresInSeconds: number;
};
export interface GoogleAuthorizationClient {
  getAuthorizationUrl(input: { state: string; codeChallenge: string }): string;
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<{
    accessToken: SecretValue;
    refreshToken: SecretValue | null;
    scopes: readonly string[];
    expiresInSeconds: number;
  }>;
  refreshAccessToken(refreshToken: SecretValue): Promise<GoogleTokenSet>;
  revokeToken(token: SecretValue): Promise<void>;
}
export type ProviderClients = {
  text: TextGenerationClient;
  googleAuthorization: GoogleAuthorizationClient;
  gmail: (getAccessToken: AccessTokenProvider) => GmailClient;
};
