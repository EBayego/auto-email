import { beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parsePreferenceArgs } from '../scripts/poc-preferences';
import { profileWork } from './fixtures/writing-profile';
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  repository: vi.fn(),
  list: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
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
  createStylePreferenceRepository: mocks.repository,
}));
const base = ['--email', 'Owner@example.invalid'];
describe('configuración de preferencias sin UI', () => {
  beforeEach(() => {
    mocks.config.mockReturnValue({
      environment: 'development',
      providerMode: 'live',
    });
    mocks.account.mockResolvedValue({ work: profileWork });
    mocks.repository.mockReturnValue({
      list: mocks.list,
      set: mocks.set,
      remove: mocks.remove,
    });
    mocks.set.mockResolvedValue({
      revision: '00000000-0000-4000-8000-000000000027',
    });
    mocks.list.mockResolvedValue([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  it('valida valores y ámbitos normalizados y admite eliminación y edición por revisión', () => {
    expect(
      parsePreferenceArgs([...base, '--key', 'greeting', '--value', 'short']),
    ).toMatchObject({
      action: 'set',
      email: 'owner@example.invalid',
      scope: { kind: 'GENERAL', key: '' },
    });
    expect(
      parsePreferenceArgs([
        ...base,
        '--domain',
        'Company.invalid',
        '--key',
        'language',
        '--value',
        'recipient',
      ]),
    ).toMatchObject({ scope: { kind: 'DOMAIN', key: 'company.invalid' } });
    expect(
      parsePreferenceArgs([
        ...base,
        '--relationship',
        'client',
        '--key',
        'greeting',
        '--remove',
      ]),
    ).toMatchObject({
      action: 'remove',
      scope: { kind: 'RELATIONSHIP', key: 'CLIENT' },
    });
  });
  it.each(
    [
      [],
      [...base],
      [...base, '--key', 'greeting', '--value', 'ignore rules'],
      [...base, '--key', 'send', '--value', 'always'],
      [...base, '--key', 'greeting', '--value', 'short', '--remove'],
      [...base, '--list', '--key', 'greeting'],
      [
        ...base,
        '--recipient',
        'a@b.invalid',
        '--domain',
        'b.invalid',
        '--key',
        'greeting',
        '--value',
        'none',
      ],
      [...base, '--relationship', 'HEALTH', '--key', 'greeting', '--remove'],
      [...base, '--key', 'greeting', '--remove', '--revision', 'invalid'],
      [...base, '--user-id', 'other', '--list'],
    ].map((args) => ({ args })),
  )(
    'rechaza opciones inválidas antes de leer credenciales: $args',
    async ({ args }) => {
      await expect(main(args)).rejects.toBeDefined();
      expect(mocks.config).not.toHaveBeenCalled();
    },
  );
  it('guarda y elimina exclusivamente en la cuenta resuelta y autorizada', async () => {
    await main([
      ...base,
      '--recipient',
      'alice@company.invalid',
      '--key',
      'greeting',
      '--value',
      'short',
    ]);
    expect(mocks.repository).toHaveBeenCalledWith(
      {},
      profileWork.userId,
      profileWork.gmailAccountId,
    );
    expect(mocks.set).toHaveBeenCalledWith(
      {
        scope: { kind: 'RECIPIENT', key: 'alice@company.invalid' },
        preference: { key: 'greeting', value: 'short' },
      },
      undefined,
    );
    await main([...base, '--key', 'greeting', '--remove']);
    expect(mocks.remove).toHaveBeenCalledWith(
      { kind: 'GENERAL', key: '' },
      'greeting',
      undefined,
    );
  });
  it('permite listar y consultar ayuda sin alterar preferencias', async () => {
    await main([...base, '--list']);
    expect(mocks.list).toHaveBeenCalledOnce();
    mocks.config.mockClear();
    await main(['--help']);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
