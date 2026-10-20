import { beforeEach, describe, expect, it, vi } from 'vitest';
import { main, parseRelationshipArgs } from '../scripts/poc-relationships';
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@next/env', () => ({ default: { loadEnvConfig: vi.fn() } }));
vi.mock('@/config/env', async (original) => ({
  ...(await original<typeof import('@/config/env')>()),
  getServerConfig: () => ({ environment: 'development', providerMode: 'live' }),
}));
vi.mock('@/db/service-client', () => ({ createServiceDataClient: () => ({}) }));
vi.mock('@/db/poc-account', () => ({ resolvePocAccount: mocks.account }));
vi.mock('@/db/style-relationships', () => ({
  createStyleRelationshipRepository: () => ({
    set: mocks.set,
    remove: mocks.remove,
    list: mocks.list,
  }),
}));
const email = ['--email', 'owner@example.invalid'];
describe('MAIL-025, configuración explícita de categorías', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.account.mockResolvedValue({
      work: { userId: 'owner', gmailAccountId: 'account' },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  it('asigna únicamente la categoría pedida por el titular', async () => {
    await main([
      ...email,
      '--recipient',
      'Person@Company.Invalid',
      '--category',
      'client',
    ]);
    expect(mocks.set).toHaveBeenCalledWith({
      kind: 'RECIPIENT',
      key: 'person@company.invalid',
      category: 'CLIENT',
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('retira una asignación y no consulta Gmail ni un modelo', async () => {
    await main([...email, '--domain', 'Company.Invalid', '--remove']);
    expect(mocks.remove).toHaveBeenCalledWith({
      kind: 'DOMAIN',
      key: 'company.invalid',
    });
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it.each([
    [],
    [...email],
    [...email, '--recipient', 'bad', '--category', 'CLIENT'],
    [...email, '--domain', 'company.invalid', '--category', 'HEALTH'],
    [
      ...email,
      '--domain',
      'company.invalid',
      '--recipient',
      'a@company.invalid',
      '--category',
      'CLIENT',
    ],
    [...email, '--list', '--category', 'CLIENT'],
    [
      ...email,
      '--domain',
      'company.invalid',
      '--remove',
      '--category',
      'CLIENT',
    ],
  ])('rechaza combinaciones ambiguas o etiquetas sensibles: %j', (...args) =>
    expect(() => parseRelationshipArgs(args as string[])).toThrow(),
  );
  it('la ayuda no requiere credenciales', async () => {
    await main(['--help']);
    expect(mocks.account).not.toHaveBeenCalled();
  });
});
