import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailFixtures } from './fixtures/emails';
import { profileWork, writingProfileRow } from './fixtures/writing-profile';
import { readyResponse, supportedResponse } from './fixtures/responses';
import { main, parseGenerateArgs } from '../scripts/poc-generate';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  style: vi.fn(),
  gmailFor: vi.fn(),
  getThread: vi.fn(),
  getMessage: vi.fn(),
  listMessages: vi.fn(),
  generate: vi.fn(),
  createDraft: vi.fn(),
  load: vi.fn(),
}));
vi.mock('@next/env', () => ({ default: { loadEnvConfig: vi.fn() } }));
vi.mock('@/config/env', async (original) => ({
  ...(await original<typeof import('@/config/env')>()),
  getServerConfig: mocks.config,
}));
vi.mock('@/db/service-client', () => ({
  createServiceDataClient: vi.fn(() => ({})),
}));
vi.mock('@/db/poc-account', () => ({ resolvePocAccount: mocks.account }));
vi.mock('@/db/style-preferences', () => ({
  createStylePreferenceRepository: vi.fn(() => ({
    resolve: vi.fn(async () => ({ preferences: [], revisions: [] })),
  })),
}));
vi.mock('@/db/writing-profiles', () => ({
  createWritingProfileRepository: vi.fn(() => ({ get: mocks.style })),
}));
vi.mock('@/db/contextual-styles', () => ({
  selectContextualWritingProfile: (...args: unknown[]) => mocks.style(...args),
}));
vi.mock('@/poc/sent-sample-store', () => ({
  createSentSampleStore: vi.fn(() => ({ load: mocks.load })),
}));
vi.mock('@/worker/runtime', () => ({
  createWorkerRuntime: vi.fn(() => ({
    gmailFor: mocks.gmailFor,
    knowledgeFor: vi.fn(async () => undefined),
    policyFor: vi.fn(async () => undefined),
    factualValidationFor: vi.fn(async () => ({ record: vi.fn() })),
    providers: { text: { generate: mocks.generate } },
  })),
}));

describe('comando del primer generador de respuestas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mockReturnValue({
      environment: 'development',
      providerMode: 'live',
    });
    mocks.account.mockResolvedValue({
      work: profileWork,
      account: { email: 'owner@example.invalid' },
    });
    mocks.style.mockResolvedValue({
      ...writingProfileRow(),
      review_status: 'CONFIRMED',
    });
    mocks.load.mockResolvedValue(null);
    mocks.listMessages.mockResolvedValue({ messages: [] });
    mocks.gmailFor.mockResolvedValue({
      getThread: mocks.getThread,
      getMessage: mocks.getMessage,
      listMessages: mocks.listMessages,
      createDraft: mocks.createDraft,
    });
    mocks.getThread.mockResolvedValue(
      createEmailFixtures(
        'Hola, por favor confirma que has recibido este correo. Gracias.',
      ).pending,
    );
    mocks.generate
      .mockReset()
      .mockResolvedValueOnce({
        text: JSON.stringify(readyResponse()),
        inputTokens: 100,
        outputTokens: 80,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(supportedResponse()),
        inputTokens: 50,
        outputTokens: 20,
      });
  });
  it('valida la cuenta, el objetivo y el número de ejemplos', () => {
    expect(
      parseGenerateArgs([
        '--email',
        'Owner@example.invalid',
        '--thread-id',
        'thread',
        '--style-examples',
        '0',
        '--preview',
      ]),
    ).toMatchObject({
      action: 'generate',
      examples: 0,
      preview: true,
      selection: {
        mailboxAddress: 'owner@example.invalid',
        threadId: 'thread',
      },
    });
  });
  it.each(
    [
      [],
      ['--email', 'owner@example.invalid'],
      ['--email', 'bad', '--thread-id', 'thread'],
      ['--email', 'owner@example.invalid', '--thread-id', '../other'],
      [
        '--email',
        'owner@example.invalid',
        '--thread-id',
        'thread',
        '--style-examples',
        '4',
      ],
      [
        '--email',
        'owner@example.invalid',
        '--thread-id',
        'thread',
        '--style-examples',
        '-1',
      ],
      ['--email', 'owner@example.invalid', '--thread-id', 'thread', '--send'],
      [
        '--email',
        'owner@example.invalid',
        '--thread-id',
        'thread',
        '--user-id',
        'attacker',
      ],
    ].map((args) => ({ args })),
  )('rechaza $args antes de cargar credenciales', async ({ args }) => {
    await expect(main(args)).rejects.toBeDefined();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.getThread).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('genera para la cuenta autorizada sin escribir en Gmail ni imprimir correos o propuestas por defecto', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await main([
      '--email',
      'owner@example.invalid',
      '--thread-id',
      createEmailFixtures().pending.id,
    ]);
    expect(result).toMatchObject({
      selection: { accountId: profileWork.gmailAccountId },
      generation: { status: 'READY', modelCalls: 2 },
    });
    expect(mocks.gmailFor).toHaveBeenCalledExactlyOnceWith(profileWork);
    expect(mocks.createDraft).not.toHaveBeenCalled();
    const printed = log.mock.calls[0][0];
    expect(printed).not.toMatch(/he recibido|podemos reunirnos|bodyText/);
    expect(JSON.parse(printed)).not.toHaveProperty('preview');
  });
  it('la propuesta solo se muestra al pedir --preview expresamente', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main([
      '--email',
      'owner@example.invalid',
      '--thread-id',
      createEmailFixtures().pending.id,
      '--preview',
      '--style-examples',
      '0',
    ]);
    expect(JSON.parse(log.mock.calls[0][0]).preview).toMatchObject({
      status: 'READY',
      bodyText: readyResponse().bodyText,
    });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });
  it('informa de datos faltantes sin permitir un cuerpo parcial', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.generate.mockReset().mockResolvedValueOnce({
      text: JSON.stringify({
        ...readyResponse(),
        status: 'INSUFFICIENT_CONTEXT',
        bodyText: null,
        missingInformation: ['Tarifa vigente'],
        warnings: ['MISSING_INFORMATION'],
      }),
      inputTokens: 1,
      outputTokens: 1,
    });
    await main([
      '--email',
      'owner@example.invalid',
      '--thread-id',
      createEmailFixtures().pending.id,
      '--preview',
    ]);
    expect(JSON.parse(log.mock.calls[0][0]).preview).toEqual({
      status: 'INSUFFICIENT_CONTEXT',
      bodyText: null,
      missingInformation: ['Tarifa vigente'],
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });
  it('no llama a OpenAI cuando el hilo ya tiene respuesta o falta el perfil confirmado', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.getThread.mockResolvedValue(createEmailFixtures().answered);
    expect(
      (
        await main([
          '--email',
          'owner@example.invalid',
          '--thread-id',
          createEmailFixtures().answered.id,
        ])
      )?.generation,
    ).toBeNull();
    expect(mocks.generate).not.toHaveBeenCalled();
    mocks.style.mockResolvedValue(writingProfileRow());
    await expect(
      main(['--email', 'owner@example.invalid', '--thread-id', 'thread']),
    ).rejects.toMatchObject({ code: 'STYLE_PROFILE_REQUIRED' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('la ayuda no necesita credenciales', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
