import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailFixtures } from './fixtures/emails';
import { profileWork, writingProfileRow } from './fixtures/writing-profile';
import { main, parseSelectArgs } from '../scripts/poc-select';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  style: vi.fn(),
  gmailFor: vi.fn(),
  getThread: vi.fn(),
  generate: vi.fn(),
  createDraft: vi.fn(),
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
vi.mock('@/db/writing-profiles', () => ({
  createWritingProfileRepository: vi.fn(() => ({ get: mocks.style })),
}));
vi.mock('@/worker/runtime', () => ({
  createWorkerRuntime: vi.fn(() => ({
    gmailFor: mocks.gmailFor,
    providers: { text: { generate: mocks.generate } },
  })),
}));

describe('comando CLI del selector manual', () => {
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
    mocks.gmailFor.mockResolvedValue({
      getThread: mocks.getThread,
      createDraft: mocks.createDraft,
    });
    mocks.getThread.mockResolvedValue(createEmailFixtures().pending);
  });
  it('acepta el hilo y un mensaje opcional y normaliza la cuenta seleccionada', () => {
    expect(
      parseSelectArgs([
        '--email',
        'Owner@example.invalid',
        '--thread-id',
        'thread',
        '--message-id',
        'message',
        '--alias',
        'alias@example.invalid',
      ]),
    ).toMatchObject({
      action: 'select',
      mailboxAddress: 'owner@example.invalid',
      threadId: 'thread',
      targetMessageId: 'message',
      aliases: ['alias@example.invalid'],
    });
  });
  it.each(
    [
      [],
      ['--email', 'owner@example.invalid'],
      ['--thread-id', 'thread'],
      ['--email', 'bad', '--thread-id', 'thread'],
      ['--email', 'owner@example.invalid', '--thread-id', '../profile'],
      [
        '--email',
        'owner@example.invalid',
        '--thread-id',
        'thread',
        '--alias',
        'bad',
      ],
      [
        '--email',
        'owner@example.invalid',
        '--thread-id',
        'thread',
        '--message-id',
        'bad/id',
      ],
      [
        '--email',
        'owner@example.invalid',
        '--thread-id',
        'thread',
        '--user-id',
        'attacker',
      ],
      ['--email', 'owner@example.invalid', '--thread-id', 'thread', '--send'],
    ].map((args) => ({ args })),
  )('rechaza $args antes de cargar credenciales', async ({ args }) => {
    await expect(main(args)).rejects.toBeDefined();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.getThread).not.toHaveBeenCalled();
  });
  it('usa la cuenta verificada y el perfil confirmado; imprime solo un informe sin contenido', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pending = createEmailFixtures().pending;
    const result = await main([
      '--email',
      'owner@example.invalid',
      '--thread-id',
      pending.id,
    ]);
    expect(mocks.gmailFor).toHaveBeenCalledExactlyOnceWith(profileWork);
    expect(mocks.getThread).toHaveBeenCalledExactlyOnceWith(pending.id, {
      format: 'full',
    });
    expect(result).toMatchObject({
      accountId: profileWork.gmailAccountId,
      status: 'SELECTED',
      contextPrepared: true,
      styleRevision: writingProfileRow().revision,
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).not.toMatch(
      /podemos reunirnos|contact@example|Consulta sintética/,
    );
  });
  it('no utiliza un perfil sin confirmar y sigue permitiendo recuperar el hilo para análisis', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.style.mockResolvedValue(writingProfileRow());
    const result = await main([
      '--email',
      'owner@example.invalid',
      '--thread-id',
      createEmailFixtures().pending.id,
    ]);
    expect(result).toMatchObject({
      status: 'SELECTED',
      styleRevision: null,
      warnings: ['STYLE_PROFILE_UNAVAILABLE'],
    });
  });
  it('impide acceder a Gmail si falla la selección de cuenta autorizada', async () => {
    mocks.account.mockRejectedValue(new Error('not authorized'));
    await expect(
      main(['--email', 'owner@example.invalid', '--thread-id', 'thread']),
    ).rejects.toThrow('not authorized');
    expect(mocks.getThread).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('la ayuda no requiere credenciales ni consulta Gmail', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.getThread).not.toHaveBeenCalled();
  });
});
