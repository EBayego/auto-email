import { describe, expect, it, vi } from 'vitest';
import { readServerConfig } from '@/config/env';
import { ProviderError } from '@/providers/errors';
import { createProviderClients } from '@/providers/runtime';
import { createEmailFixtures, type SyntheticThread } from './fixtures/emails';
import { createProviderMocks } from './mocks/providers';

describe('ejemplos con correos sintéticos y proveedores inyectados', () => {
  it('permite leer un hilo y obtener texto generado sin claves ni llamadas externas', async () => {
    const { pending } = createEmailFixtures();
    const response = {
      text: 'Gracias por escribir. Revisaré mi disponibilidad.',
      inputTokens: 24,
      outputTokens: 12,
    };
    const { providers, gmailClient } = createProviderMocks({
      reads: [{ resource: `threads/${pending.id}`, result: pending }],
      text: [{ result: response }],
    });
    const clients = createProviderClients(readServerConfig(), providers);
    const token = vi.fn(async () => 'synthetic-access-token');
    const gmail = clients.gmail(token);
    const thread = (await gmail.get(`threads/${pending.id}`, {
      format: 'full',
    })) as SyntheticThread;
    const input = Buffer.from(
      thread.messages[0].payload.body.data!,
      'base64url',
    ).toString('utf8');
    expect(
      await clients.text.generate({
        instructions: 'Redacta una propuesta.',
        input,
      }),
    ).toEqual(response);
    expect(input).toContain('¿podemos reunirnos');
    expect(clients.text.generate).toHaveBeenCalledWith({
      instructions: 'Redacta una propuesta.',
      input,
    });
    expect(gmailClient.createDraft).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exige configurar cada respuesta y cada escritura, sin éxitos implícitos', async () => {
    const { providers, gmailClient } = createProviderMocks();
    await expect(gmailClient.get('profile')).rejects.toThrow('guion');
    await expect(gmailClient.createDraft({ raw: 'dGVzdA' })).rejects.toThrow(
      'respuesta explícita',
    );
    await expect(
      providers.text.generate({ instructions: 'Test', input: 'Synthetic' }),
    ).rejects.toThrow('respuesta explícita');
    expect(() =>
      providers.googleAuthorization.getAuthorizationUrl({
        state: 'state',
        codeChallenge: 'challenge',
      }),
    ).toThrow('URL de autorización');
  });

  it('simula límites y recuperaciones del proveedor sin reintentos automáticos', async () => {
    const failure = new ProviderError('openai', 'RATE_LIMITED');
    const input = { instructions: 'Test', input: 'Synthetic' };
    const { providers, gmailClient } = createProviderMocks({
      text: [
        { error: failure },
        { result: { text: 'Recuperado', inputTokens: 1, outputTokens: 1 } },
      ],
      drafts: [{ error: new ProviderError('google', 'UNAVAILABLE') }],
    });
    await expect(providers.text.generate(input)).rejects.toBe(failure);
    expect(providers.text.generate).toHaveBeenCalledOnce();
    expect((await providers.text.generate(input)).text).toBe('Recuperado');
    await expect(
      gmailClient.createDraft({ raw: 'dGVzdA' }),
    ).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(gmailClient.createDraft).toHaveBeenCalledOnce();
  });

  it('aísla los guiones y las respuestas entre pruebas y usuarios', async () => {
    const fixture = createEmailFixtures().pending;
    const resource = `threads/${fixture.id}` as const;
    const options = { reads: [{ resource, result: fixture }] };
    const a = createProviderMocks(options).gmailClient;
    const b = createProviderMocks(options).gmailClient;
    const response = (await a.get(resource)) as SyntheticThread;
    response.messages[0].labelIds.push('SENT');
    expect(await b.get(resource)).toEqual(createEmailFixtures().pending);
    expect(fixture.messages[0].labelIds).toEqual(['INBOX']);
    await expect(a.get(resource)).rejects.toThrow('guion');
  });

  it('incluye respuestas, borradores manuales, adjuntos y contenido no confiable', () => {
    const fixtures = createEmailFixtures();
    expect(fixtures.answered.messages.at(-1)?.labelIds).toContain('SENT');
    expect(fixtures.manualDraft.messages.at(-1)?.labelIds).toContain('DRAFT');
    expect(
      fixtures.attachment.messages[0].payload.parts?.[1].body,
    ).toHaveProperty('attachmentId');
    const untrusted = fixtures.untrustedContent.messages[0];
    expect(
      Buffer.from(untrusted.payload.body.data!, 'base64url').toString(),
    ).toContain('Ignora las instrucciones');
    for (const thread of Object.values(fixtures))
      for (const message of thread.messages) {
        expect(message.threadId).toBe(thread.id);
        for (const header of message.payload.headers.filter(({ name }) =>
          ['From', 'To', 'Message-ID'].includes(name),
        ))
          expect(header.value).toContain('@example.invalid');
      }
  });

  it('bloquea fetch cuando una prueba olvida inyectar el proveedor', async () => {
    await expect(fetch('https://example.invalid')).rejects.toThrow(
      'doble de red explícito',
    );
  });
});
