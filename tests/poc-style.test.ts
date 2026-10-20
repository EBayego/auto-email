import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileWork, writingProfileRow } from './fixtures/writing-profile';
import { main, parseStyleArgs } from '../scripts/poc-style';

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  get: vi.fn(),
  confirm: vi.fn(),
  runtime: vi.fn(),
  store: vi.fn(),
  generate: vi.fn(),
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
  createWritingProfileRepository: vi.fn(() => ({
    get: mocks.get,
    confirm: mocks.confirm,
  })),
}));
vi.mock('@/worker/runtime', () => ({ createWorkerRuntime: mocks.runtime }));
vi.mock('@/poc/sent-sample-store', () => ({
  createSentSampleStore: mocks.store,
}));
vi.mock('@/poc/generate-writing-profile', () => ({
  generateWritingProfile: mocks.generate,
}));

describe('comando manual de perfil de escritura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mockReturnValue({
      environment: 'development',
      providerMode: 'live',
      openai: { model: 'test-model' },
    });
    mocks.account.mockResolvedValue({
      work: profileWork,
      account: { email: 'owner@example.invalid' },
    });
    mocks.get.mockResolvedValue(writingProfileRow());
    mocks.confirm.mockResolvedValue({
      ...writingProfileRow(),
      review_status: 'CONFIRMED',
    });
  });
  it('valida el email y una sola acción por invocación', () => {
    expect(parseStyleArgs(['--email', 'Owner@example.invalid'])).toMatchObject({
      action: 'generate',
      email: 'owner@example.invalid',
      refresh: false,
    });
    expect(
      parseStyleArgs([
        '--email',
        'owner@example.invalid',
        '--confirm',
        writingProfileRow().revision,
      ]),
    ).toMatchObject({
      action: 'confirm',
      revision: writingProfileRow().revision,
    });
  });
  it('selecciona contextos explícitos para consultar y confirmar, y permite reconstruir grupos', () => {
    expect(
      parseStyleArgs([
        '--email',
        'owner@example.invalid',
        '--recipient',
        'Person@Company.Invalid',
        '--show',
      ]),
    ).toMatchObject({
      action: 'show',
      scope: { kind: 'RECIPIENT', key: 'person@company.invalid' },
    });
    expect(
      parseStyleArgs(['--email', 'owner@example.invalid', '--contexts']),
    ).toMatchObject({
      action: 'contexts',
      scope: { kind: 'GENERAL', key: '' },
    });
    expect(() =>
      parseStyleArgs([
        '--email',
        'owner@example.invalid',
        '--contexts',
        '--refresh',
      ]),
    ).toThrow();
    expect(() =>
      parseStyleArgs([
        '--email',
        'owner@example.invalid',
        '--relationship',
        'HEALTH',
        '--show',
      ]),
    ).toThrow();
    expect(() =>
      parseStyleArgs([
        '--email',
        'owner@example.invalid',
        '--recipient',
        'a@company.invalid',
      ]),
    ).toThrow();
  });
  it.each(
    [
      [],
      ['--email', 'bad'],
      ['--email', 'owner@example.invalid', '--refresh', '--show'],
      ['--email', 'owner@example.invalid', '--confirm', 'bad'],
      ['--email', 'owner@example.invalid', '--alias', 'bad'],
      [
        '--email',
        'owner@example.invalid',
        '--refresh',
        '--confirm',
        writingProfileRow().revision,
      ],
      ['--email', 'owner@example.invalid', '--unknown'],
    ].map((args) => ({ args })),
  )('rechaza $args', ({ args }) => {
    expect(() => parseStyleArgs(args)).toThrow();
  });
  it('reutiliza el perfil existente sin cargar cuerpos ni inicializar proveedores', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--email', 'owner@example.invalid']);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0][0]).reused).toBe(true);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      version: 1,
      schemaVersion: 2,
      origin: 'SENT_HISTORY',
      updatedAt: writingProfileRow().updated_at,
    });
  });
  it('confirma únicamente la revisión solicitada explícitamente y no regenera', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main([
      '--email',
      'owner@example.invalid',
      '--confirm',
      writingProfileRow().revision,
    ]);
    expect(mocks.confirm).toHaveBeenCalledWith(writingProfileRow().revision);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('muestra un error si se consulta un perfil inexistente, sin lanzar un análisis', async () => {
    mocks.get.mockResolvedValue(null);
    await expect(
      main(['--email', 'owner@example.invalid', '--show']),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('la ayuda no necesita credenciales', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--help']);
    expect(mocks.config).not.toHaveBeenCalled();
  });
});
