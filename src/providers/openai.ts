import OpenAI from 'openai';
import type { ServerConfig } from '@/config/env';
import type { TextGenerationClient, TextGenerationInput } from './contracts';
import { ProviderError, providerFailure } from './errors';
import {
  directProviderRequest,
  parseRetryAfter,
  type ProviderRequestExecutor,
} from './request-policy';

type LiveConfig = Extract<ServerConfig, { providerMode: 'live' }>;

export function createOpenAiClient(
  config: LiveConfig['openai'],
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
  execute: ProviderRequestExecutor = directProviderRequest,
): TextGenerationClient {
  const client = new OpenAI({
    baseURL: 'https://api.openai.com/v1',
    organization: null,
    project: null,
    apiKey: config.apiKey.reveal(),
    timeout: timeoutMs,
    maxRetries: 0,
    logLevel: 'off',
    fetch: fetcher,
  });
  return Object.freeze({
    async generate(input: TextGenerationInput) {
      if (
        !input ||
        typeof input.input !== 'string' ||
        !input.input.trim() ||
        typeof input.instructions !== 'string' ||
        !input.instructions.trim()
      )
        throw new ProviderError('openai', 'REQUEST_REJECTED');
      try {
        let inputTokens = 0,
          outputTokens = 0;
        let modelCalls = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await execute(
            'openai',
            true,
            async (remainingMs) => {
              try {
                modelCalls++;
                return await client.responses.create(
                  {
                    model: config.model,
                    instructions:
                      attempt === 0
                        ? input.instructions
                        : input.instructions +
                          '\nLa salida anterior no cumplió el formato completo requerido. Devuelve JSON compacto: exactamente un objeto, sin una segunda versión ni objetos concatenados, sin redundancias y con citas breves literales suficientes. Conserva todas las preguntas esenciales, las restricciones, el estilo solicitado y la verificación factual; si faltan datos, abstente.',
                    input: [
                      {
                        role: 'user',
                        content: [{ type: 'input_text', text: input.input }],
                      },
                    ],
                    tool_choice: 'none',
                    max_output_tokens: config.maxOutputTokens,
                    store: false,
                    ...(config.reasoningEffort === 'omit'
                      ? {}
                      : { reasoning: { effort: config.reasoningEffort } }),
                    ...(input.jsonSchema
                      ? {
                          text: {
                            format: {
                              type: 'json_schema',
                              name: input.jsonSchema.name,
                              schema: input.jsonSchema.schema,
                              strict: true,
                            },
                          },
                        }
                      : {}),
                  },
                  {
                    timeout: Math.max(
                      1,
                      Math.min(timeoutMs, remainingMs ?? timeoutMs),
                    ),
                  },
                );
              } catch (error) {
                if (error instanceof ProviderError) throw error;
                if (error instanceof OpenAI.APIError) {
                  const hardQuota =
                    error.status === 429 &&
                    [
                      'insufficient_quota',
                      'billing_hard_limit_reached',
                      'usage_limit_reached',
                    ].some(
                      (code) => code === error.code || code === error.type,
                    );
                  throw new ProviderError(
                    'openai',
                    hardQuota
                      ? 'QUOTA_EXCEEDED'
                      : providerFailure('openai', error.status).code,
                    {
                      httpStatus: error.status,
                      retryAfterMs: parseRetryAfter(
                        error.headers?.get('retry-after') ?? null,
                      ),
                    },
                  );
                }
                throw providerFailure('openai');
              }
            },
          );
          inputTokens += response.usage?.input_tokens ?? 0;
          outputTokens += response.usage?.output_tokens ?? 0;
          // This client has no action dispatcher. Reject action-shaped output
          // even if it also includes apparently valid structured text.
          if (
            !Array.isArray(response.output) ||
            response.output.some(
              (item) =>
                item.type !== 'reasoning' &&
                (item.type !== 'message' ||
                  item.role !== 'assistant' ||
                  item.content.some((part) => part.type !== 'output_text')),
            )
          )
            throw new ProviderError('openai', 'INVALID_RESPONSE');
          let invalidJson = false;
          if (
            input.jsonSchema &&
            response.status === 'completed' &&
            response.output_text
          ) {
            try {
              JSON.parse(response.output_text);
            } catch {
              invalidJson = true;
            }
          }
          if (
            attempt === 0 &&
            ((response.status === 'incomplete' &&
              response.incomplete_details?.reason === 'max_output_tokens') ||
              invalidJson)
          )
            continue;
          if (
            response.status !== 'completed' ||
            !response.output_text ||
            invalidJson
          )
            throw new ProviderError('openai', 'INVALID_RESPONSE');
          return {
            text: response.output_text,
            inputTokens,
            outputTokens,
            ...(modelCalls > 1 ? { attempts: modelCalls } : {}),
          };
        }
        throw new ProviderError('openai', 'INVALID_RESPONSE');
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw providerFailure(
          'openai',
          error instanceof OpenAI.APIError ? error.status : undefined,
        );
      }
    },
  });
}
