import { describe, expect, it, vi } from 'vitest';
import { SecretValue, type ServerConfig } from '@/config/env';
import { createGmailClient } from './gmail';
import { createGoogleAuthorizationClient, gmailScopes } from './google';
import { createOpenAiClient } from './openai';
import { createProviderClients } from './runtime';
import type { GmailReadResource, ProviderClients } from './contracts';

const aiConfig = {
  apiKey: new SecretValue('sk-unit-private'),
  model: 'configurable-model',
  reasoningEffort: 'none' as const,
  maxOutputTokens: 2048,
};
const oauthConfig = {
  clientId: 'unit.apps.googleusercontent.com',
  clientSecret: new SecretValue('google-unit-private'),
  redirectUri: 'http://localhost:3000/api/gmail/callback',
};
const completed = {
  id: 'resp_unit',
  object: 'response',
  status: 'completed',
  output: [
    {
      id: 'msg_unit',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }],
    },
  ],
  usage: { input_tokens: 5, output_tokens: 3 },
};

describe('clientes de proveedores', () => {
  it.each([
    'function_call',
    'web_search_call',
    'mcp_call',
    'computer_call',
    'shell_call',
    'unknown_action',
  ])(
    'rechaza una salida de acción %s aunque contenga JSON válido, sin reintentar',
    async (type) => {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
        Response.json({
          ...completed,
          output: [
            ...completed.output,
            { type, name: 'gmail.send', arguments: '{}' },
          ],
        }),
      );
      await expect(
        createOpenAiClient(aiConfig, 30000, fetcher).generate({
          instructions: 'Rules',
          input: 'Untrusted data',
          jsonSchema: { name: 'result', schema: { type: 'object' } },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it('rechaza JSON concatenado como salida ambigua y solicita un solo objeto sin elegir uno arbitrariamente', async () => {
    const ambiguous = structuredClone(completed);
    ambiguous.output[0].content[0].text = '{"ok":false}{"ok":true}';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(ambiguous))
      .mockResolvedValueOnce(Response.json(completed));
    const result = await createOpenAiClient(aiConfig, 30000, fetcher).generate({
      instructions: 'Rules',
      input: 'Synthetic',
      jsonSchema: { name: 'result', schema: { type: 'object' } },
    });
    expect(result).toMatchObject({ text: '{"ok":true}', attempts: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetcher.mock.calls[1][1]?.body)).instructions,
    ).toContain('sin una segunda versión ni objetos concatenados');
    const alwaysAmbiguous = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(ambiguous));
    await expect(
      createOpenAiClient(aiConfig, 30000, alwaysAmbiguous).generate({
        instructions: 'Rules',
        input: 'Synthetic',
        jsonSchema: { name: 'result', schema: { type: 'object' } },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(alwaysAmbiguous).toHaveBeenCalledTimes(2);
  });
  it('reintenta una sola vez salidas truncadas, mantiene modelo y presupuesto y suma el consumo real', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ...completed,
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 10, output_tokens: 2048 },
        }),
      )
      .mockResolvedValueOnce(Response.json(completed));
    const result = await createOpenAiClient(aiConfig, 30000, fetcher).generate({
      instructions: 'Reglas de seguridad',
      input: 'Synthetic',
    });
    expect(result).toMatchObject({
      attempts: 2,
      inputTokens: 15,
      outputTokens: 2051,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(
      bodies.every(
        (body) =>
          body.model === aiConfig.model &&
          body.max_output_tokens === 2048 &&
          body.store === false &&
          !body.tools,
      ),
    ).toBe(true);
    expect(bodies[1].instructions).toContain('Reglas de seguridad');
    expect(bodies[1].instructions).toContain('JSON compacto');
    expect(bodies[1].input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Synthetic' }] },
    ]);
    expect(bodies.every((body) => body.tool_choice === 'none')).toBe(true);
  });
  it('no repite rechazos de contenido ni convierte una segunda salida truncada en válida', async () => {
    const refused = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...completed,
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      }),
    );
    await expect(
      createOpenAiClient(aiConfig, 30000, refused).generate({
        instructions: 'Rules',
        input: 'Synthetic',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(refused).toHaveBeenCalledOnce();
    const truncated = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        ...completed,
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    );
    await expect(
      createOpenAiClient(aiConfig, 30000, truncated).generate({
        instructions: 'Rules',
        input: 'Synthetic',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(truncated).toHaveBeenCalledTimes(2);
  });
  it('ignora endpoints y proyectos OpenAI ambientales ajenos a la configuración', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://attacker.example/v1');
    vi.stubEnv('OPENAI_PROJECT_ID', 'another-project');
    vi.stubEnv('OPENAI_ORG_ID', 'another-organization');
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(completed));
      await createOpenAiClient(aiConfig, 30000, fetcher).generate({
        instructions: 'Instruction',
        input: 'Synthetic',
      });
      const [url, init] = fetcher.mock.calls[0];
      expect(String(url)).toBe('https://api.openai.com/v1/responses');
      expect(new Headers(init?.headers).get('OpenAI-Project')).toBeNull();
      expect(new Headers(init?.headers).get('OpenAI-Organization')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('OpenAI usa el modelo configurado, salida estructurada y store:false sin permitir opciones arbitrarias', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(completed));
    const client = createOpenAiClient(aiConfig, 30000, fetcher);
    const result = await client.generate({
      instructions: 'System instruction',
      input: 'Synthetic text',
      jsonSchema: { name: 'result', schema: { type: 'object' } },
      ...{
        store: true,
        model: 'attacker-model',
        tools: [{ type: 'web_search' }],
        tool_choice: 'required',
        previous_response_id: 'foreign-response',
        conversation: 'foreign-history',
      },
    });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.model).toBe(aiConfig.model);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBe('none');
    expect(body.previous_response_id).toBeUndefined();
    expect(body.conversation).toBeUndefined();
    expect(result).toEqual({
      text: '{"ok":true}',
      inputTokens: 5,
      outputTokens: 3,
    });
    expect(JSON.stringify(client)).not.toContain('sk-unit-private');
  });

  it('permite cambiar a modelos sin reasoning sin modificar el servicio', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(completed));
    const client = createOpenAiClient(
      { ...aiConfig, model: 'other-model', reasoningEffort: 'omit' },
      30000,
      fetcher,
    );
    await client.generate({ instructions: 'Instruction', input: 'Synthetic' });
    expect(
      JSON.parse(String(fetcher.mock.calls[0][1]?.body)).reasoning,
    ).toBeUndefined();
  });

  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [429, 'RATE_LIMITED'],
    [500, 'UNAVAILABLE'],
  ] as const)(
    'normaliza errores OpenAI %s y no reintenta ni expone el cuerpo del proveedor',
    async (status, code) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          Response.json(
            { error: { message: 'sk-unit-private Synthetic text' } },
            { status },
          ),
        );
      const client = createOpenAiClient(aiConfig, 30000, fetcher);
      await expect(
        client.generate({
          instructions: 'Instruction',
          input: 'Synthetic text',
        }),
      ).rejects.toMatchObject({ code });
      expect(fetcher).toHaveBeenCalledTimes(1);
      try {
        await client.generate({
          instructions: 'Instruction',
          input: 'Synthetic text',
        });
      } catch (error) {
        expect(String(error) + JSON.stringify(error)).not.toContain(
          'sk-unit-private',
        );
      }
    },
  );

  it('rechaza respuestas incompletas o vacías de OpenAI', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...completed, status: 'incomplete' }));
    await expect(
      createOpenAiClient(aiConfig, 30000, fetcher).generate({
        instructions: 'Instruction',
        input: 'Synthetic',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('Google OAuth usa la redirección configurada, PKCE, estado y acceso offline sin exponer el secreto', () => {
    const client = createGoogleAuthorizationClient(oauthConfig);
    const url = new URL(
      client.getAuthorizationUrl({
        state: 's'.repeat(43),
        codeChallenge: 'c'.repeat(43),
      }),
    );
    expect(url.searchParams.get('redirect_uri')).toBe(oauthConfig.redirectUri);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toBe(gmailScopes.join(' '));
    expect(gmailScopes).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ]);
    expect(url.href + JSON.stringify(client)).not.toContain(
      'google-unit-private',
    );
    expect(() =>
      client.getAuthorizationUrl({ state: '', codeChallenge: 'bad' }),
    ).toThrow();
  });

  it('Gmail obtiene el access token mediante un proveedor inyectado y mantiene fija la cuenta me', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ messages: [] }));
    const token = vi.fn().mockResolvedValue('unit-access-token');
    await createGmailClient(token, 30000, fetcher).get('messages', {
      maxResults: 10,
      labelIds: ['INBOX'],
    });
    const [input, init] = fetcher.mock.calls[0];
    expect(String(input)).toContain('/users/me/messages?');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer unit-access-token',
    );
    expect(init?.cache).toBe('no-store');
    expect(init?.redirect).toBe('error');
  });

  it('Gmail solo escribe en drafts y evita parámetros arbitrarios o rutas de envío', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: 'draft' }));
    const client = createGmailClient(async () => 'unit-token', 30000, fetcher);
    await client.createDraft({
      raw: 'dGVzdA',
      threadId: 'thread-id',
      ...{ userId: 'victim', send: true },
    });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      message: { raw: 'dGVzdA', threadId: 'thread-id' },
    });
    await expect(
      client.get('messages/1/send' as GmailReadResource),
    ).rejects.toMatchObject({ code: 'REQUEST_REJECTED' });
    await expect(
      client.get('profile', { access_token: 'forged' }),
    ).rejects.toMatchObject({ code: 'REQUEST_REJECTED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client).not.toHaveProperty('send');
  });

  it('Gmail no reintenta escrituras fallidas ni propaga tokens o correos del error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ message: 'unit-token private body' }, { status: 500 }),
      );
    const client = createGmailClient(async () => 'unit-token', 30000, fetcher);
    try {
      await client.createDraft({ raw: 'dGVzdA' });
      throw new Error('Debe fallar');
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNAVAILABLE' });
      expect(String(error)).not.toContain('unit-token');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('solo acepta mocks explícitos en pruebas', () => {
    const mocks = {
      text: {},
      googleAuthorization: {},
      gmail: vi.fn(),
    } as unknown as ProviderClients;
    const config = {
      environment: 'test',
      providerMode: 'mock',
    } as ServerConfig;
    expect(createProviderClients(config, mocks)).toBe(mocks);
    expect(() => createProviderClients(config)).toThrow();
    expect(() =>
      createProviderClients({ ...config, environment: 'production' }, mocks),
    ).toThrow();
  });
});
