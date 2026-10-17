export type TextGenerationInput = {
  instructions: string;
  input: string;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};
export type TextGenerationResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};
export interface TextGenerationClient {
  generate(input: TextGenerationInput): Promise<TextGenerationResult>;
}

export type GmailReadResource =
  'profile' | 'messages' | `messages/${string}` | `threads/${string}`;
export type GmailQuery = Readonly<
  Record<string, string | number | boolean | readonly string[]>
>;
export interface GmailClient {
  get(resource: GmailReadResource, query?: GmailQuery): Promise<unknown>;
  createDraft(message: { raw: string; threadId?: string }): Promise<unknown>;
}
export type AccessTokenProvider = () => Promise<string>;
export interface GoogleAuthorizationClient {
  getAuthorizationUrl(input: { state: string; codeChallenge: string }): string;
}
export type ProviderClients = {
  text: TextGenerationClient;
  googleAuthorization: GoogleAuthorizationClient;
  gmail: (getAccessToken: AccessTokenProvider) => GmailClient;
};
