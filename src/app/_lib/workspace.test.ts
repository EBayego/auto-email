import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccount, createServerAuthClient } from './auth';
import { getUserData } from './data';
import { createWritingProfileRepository } from '@/db/writing-profiles';
import {
  requireAccount,
  getWorkspaceGmail,
  getRecentRuns,
  getWorkspaceStyle,
} from './workspace';

vi.mock('server-only', () => ({}));
vi.mock('./auth', () => ({
  getAccount: vi.fn(),
  createServerAuthClient: vi.fn(),
}));
vi.mock('./data', () => ({ getUserData: vi.fn() }));
vi.mock('@/db/writing-profiles', () => ({
  createWritingProfileRepository: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const account = {
  user: { id: 'owner', email: 'owner@example.invalid' },
  settings: {
    automationEnabled: false,
    pollIntervalSeconds: 300,
    maxDailyDrafts: 30,
  },
};
const gmailGet = vi.fn();
const list = vi.fn();

describe('MAIL-050 acceso del espacio autenticado', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccount).mockResolvedValue({
      status: 'authenticated',
      account,
    });
    vi.mocked(getUserData).mockResolvedValue({
      gmailAccounts: { get: gmailGet },
      processingRuns: { list },
    } as unknown as Awaited<ReturnType<typeof getUserData>>);
  });
  it.each(['unauthenticated', 'forbidden'] as const)(
    'no consulta datos para una sesión %s',
    async (status) => {
      vi.mocked(getAccount).mockResolvedValue({ status });
      await expect(getWorkspaceGmail()).rejects.toThrow('redirect:/login');
      await expect(getRecentRuns()).rejects.toThrow('redirect:/login');
      await expect(getWorkspaceStyle()).rejects.toThrow('redirect:/login');
      expect(getUserData).not.toHaveBeenCalled();
    },
  );
  it('mantiene el error de cuenta separado de la ausencia de datos', async () => {
    vi.mocked(getAccount).mockResolvedValue({ status: 'unavailable' });
    await expect(requireAccount()).rejects.toThrow('ACCOUNT_UNAVAILABLE');
    expect(getUserData).not.toHaveBeenCalled();
  });
  it('consulta solo los repositorios de la sesión y limita la actividad', async () => {
    gmailGet.mockResolvedValue(null);
    list.mockResolvedValue([]);
    expect(await getWorkspaceGmail()).toBeNull();
    expect(await getRecentRuns()).toEqual([]);
    expect(list).toHaveBeenCalledWith(20);
  });
  it.each([
    null,
    { id: 'gmail', status: 'PAUSED' },
    { id: 'gmail', status: 'REAUTH_REQUIRED' },
    { id: 'gmail', status: 'DISCONNECTED' },
  ])('no consulta un perfil sin una cuenta activa: %j', async (gmail) => {
    gmailGet.mockResolvedValue(gmail);
    expect(await getWorkspaceStyle()).toBeNull();
    expect(createWritingProfileRepository).not.toHaveBeenCalled();
  });
  it('lee el perfil con el cliente de sesión y su propietario', async () => {
    gmailGet.mockResolvedValue({ id: 'gmail', status: 'CONNECTED' });
    const client = {} as Awaited<ReturnType<typeof createServerAuthClient>>;
    vi.mocked(createServerAuthClient).mockResolvedValue(client);
    const get = vi.fn().mockResolvedValue({ version: 1 });
    vi.mocked(createWritingProfileRepository).mockReturnValue({
      get,
    } as unknown as ReturnType<typeof createWritingProfileRepository>);
    expect(await getWorkspaceStyle()).toEqual({ version: 1 });
    expect(createWritingProfileRepository).toHaveBeenCalledWith(
      client,
      account.user.id,
      'gmail',
    );
  });
  it('propaga un fallo de consulta para mostrar un error recuperable', async () => {
    gmailGet.mockRejectedValue(new Error('database unavailable'));
    await expect(getWorkspaceGmail()).rejects.toThrow('database unavailable');
  });
});
