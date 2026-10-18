import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftFixture } from './fixtures/drafts';
import { profileWork, writingProfileRow } from './fixtures/writing-profile';
import { main, parseDraftArgs } from '../scripts/poc-draft';
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  style: vi.fn(),
  gmailFor: vi.fn(),
  generate: vi.fn(),
  load: vi.fn(),
  store: vi.fn(),
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
vi.mock('@/db/draft-generations', () => ({
  createDraftGenerationRepository: mocks.store,
}));
vi.mock('@/poc/sent-sample-store', () => ({
  createSentSampleStore: vi.fn(() => ({ load: mocks.load })),
}));
vi.mock('@/worker/runtime', () => ({
  createWorkerRuntime: vi.fn(() => ({
    gmailFor: mocks.gmailFor,
    providers: { text: { generate: mocks.generate } },
  })),
}));
const args = () => [
  '--email',
  'owner@example.invalid',
  '--thread-id',
  draftFixture().thread.id,
];
describe('comando explícito para crear el primer borrador', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fixture = draftFixture();
    mocks.config.mockReturnValue({
      environment: 'development',
      providerMode: 'live',
      openai: { model: 'test-model' },
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
    mocks.store.mockReturnValue(fixture.store);
    mocks.gmailFor.mockResolvedValue(fixture.gmail);
    mocks.generate.mockImplementation(fixture.text.generate);
  });
  it('valida email, hilo, alias y límites sin permitir destinatarios o contenido arbitrarios', () => {
    expect(
      parseDraftArgs([
        '--email',
        'Owner@example.invalid',
        '--thread-id',
        'thread',
        '--style-examples',
        '0',
        '--alias',
        'alias@example.invalid',
      ]),
    ).toMatchObject({
      action: 'create',
      examples: 0,
      selection: {
        mailboxAddress: 'owner@example.invalid',
        aliases: ['alias@example.invalid'],
      },
    });
  });
  it.each(
    [
      [],
      ['--email', 'bad', '--thread-id', 'thread'],
      ['--email', 'owner@example.invalid'],
      ...['--send', '--to', '--body', '--draft-id', '--preview'].map((flag) => [
        ...args(),
        flag,
      ]),
      [...args(), '--style-examples', '4'],
    ].map((args) => ({ args })),
  )('rechaza $args antes de leer credenciales', async ({ args }) => {
    await expect(main(args)).rejects.toBeDefined();
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.gmailFor).not.toHaveBeenCalled();
  });
  it('crea para la cuenta autorizada y muestra solo IDs, estados y métricas', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(args())).toMatchObject({
      draft: { status: 'CREATED', verified: true },
    });
    expect(mocks.gmailFor).toHaveBeenCalledExactlyOnceWith(profileWork);
    expect(mocks.store).toHaveBeenCalledWith(
      {},
      profileWork.userId,
      profileWork.gmailAccountId,
    );
    expect(log.mock.calls[0][0]).not.toMatch(
      /he recibido|podemos reunirnos|bodyText|Subject:|To:/,
    );
  });
  it('exige el perfil confirmado antes de acceder a Gmail', async () => {
    mocks.style.mockResolvedValue({
      ...writingProfileRow(),
      review_status: 'UNREVIEWED',
    });
    await expect(main(args())).rejects.toMatchObject({
      code: 'STYLE_PROFILE_REQUIRED',
    });
    expect(mocks.gmailFor).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('se restringe al operador local de desarrollo', async () => {
    mocks.config.mockReturnValue({
      environment: 'production',
      providerMode: 'live',
    });
    await expect(main(args())).rejects.toThrow('LOCAL_LIVE_ONLY');
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it('la ayuda no lee secretos ni llama a los proveedores', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(log.mock.calls[0][0]).toContain('MAIL-021');
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
