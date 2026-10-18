import { vi } from 'vitest';
import type {
  GmailClient,
  GmailReadResource,
  GoogleAuthorizationClient,
  ProviderClients,
  TextGenerationClient,
  TextGenerationResult,
} from '@/providers/contracts';
import type { ProviderError } from '@/providers/errors';
import { withMessageQueries } from '@/providers/gmail-messages';

type Outcome<T> = { result: T } | { error: ProviderError };
type Read = { resource: GmailReadResource } & Outcome<unknown>;
type MockOptions = {
  text?: readonly Outcome<TextGenerationResult>[];
  reads?: readonly Read[];
  drafts?: readonly Outcome<unknown>[];
  authorizationUrl?: string;
};

function consume<T>(queue: Outcome<T>[]): T {
  const outcome = queue.shift();
  if (!outcome)
    throw new Error(
      'El mock requiere una respuesta explícita para esta llamada.',
    );
  if ('error' in outcome) throw outcome.error;
  return structuredClone(outcome.result);
}

export function createProviderMocks(options: MockOptions = {}) {
  const textQueue = [...(options.text ?? [])];
  const reads = [...(options.reads ?? [])];
  const drafts = [...(options.drafts ?? [])];
  const gmailClient = withMessageQueries({
    get: vi.fn<GmailClient['get']>(async (resource) => {
      if (reads[0]?.resource !== resource)
        throw new Error(
          'La lectura Gmail no coincide con el guion de la prueba.',
        );
      return consume(reads);
    }),
    createDraft: vi.fn<GmailClient['createDraft']>(async () => consume(drafts)),
  });
  const providers = {
    text: {
      generate: vi.fn<TextGenerationClient['generate']>(async () =>
        consume(textQueue),
      ),
    },
    googleAuthorization: {
      refreshAccessToken: vi.fn<
        GoogleAuthorizationClient['refreshAccessToken']
      >(async () => {
        throw new Error('La prueba debe configurar la renovación OAuth.');
      }),
      revokeToken: vi.fn<GoogleAuthorizationClient['revokeToken']>(async () => {
        throw new Error('La prueba debe configurar la revocación OAuth.');
      }),
      exchangeCode: vi.fn<GoogleAuthorizationClient['exchangeCode']>(
        async () => {
          throw new Error('La prueba debe configurar el intercambio OAuth.');
        },
      ),
      getAuthorizationUrl: vi.fn<
        GoogleAuthorizationClient['getAuthorizationUrl']
      >(() => {
        if (!options.authorizationUrl)
          throw new Error('La prueba debe configurar la URL de autorización.');
        return options.authorizationUrl;
      }),
    },
    gmail: vi.fn<ProviderClients['gmail']>(() => gmailClient),
  } satisfies ProviderClients;
  return { providers, gmailClient };
}
