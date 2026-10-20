import OpenAI from 'openai';
import type { ServerConfig } from '@/config/env';
import type { TextGenerationClient, TextGenerationInput } from './contracts';
import { ProviderError, providerFailure } from './errors';

type LiveConfig = Extract<ServerConfig, { providerMode: 'live' }>;

export function createOpenAiClient(
  config: LiveConfig['openai'],
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
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
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await client.responses.create({
            model: config.model,
            instructions:
              attempt === 0
                ? input.instructions
                : input.instructions +
                  '\nLa salida anterior no cumplió el formato completo requerido. Devuelve JSON compacto: exactamente un objeto, sin una segunda versión ni objetos concatenados, sin redundancias y con citas breves literales suficientes. Conserva todas las preguntas esenciales, las restricciones, el estilo solicitado y la verificación factual; si faltan datos, abstente.',
            input: input.input,
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
          });
          inputTokens += response.usage?.input_tokens ?? 0;
          outputTokens += response.usage?.output_tokens ?? 0;
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
            ...(attempt ? { attempts: attempt + 1 } : {}),
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
