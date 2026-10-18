import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataClient } from './models';
import { openUserDataAccess } from './user-data';
import { createServiceDataClient } from './service-client';
import { createGmailOAuthRepository } from './gmail-oauth-repository';
import { openGmailOAuthData } from './gmail-oauth';

vi.mock('server-only', () => ({}));
vi.mock('./user-data', () => ({ openUserDataAccess: vi.fn() }));
vi.mock('./service-client', () => ({ createServiceDataClient: vi.fn() }));
vi.mock('./gmail-oauth-repository', () => ({
  createGmailOAuthRepository: vi.fn(),
}));

const user = {
  id: '00000000-0000-4000-8000-000000000012',
  email: 'user@example.invalid',
};
const sessionId = '10000000-0000-4000-8000-000000000012';
const getClaims = vi.fn();
const client = { auth: { getClaims } } as unknown as DataClient;

describe('contexto de acceso OAuth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(openUserDataAccess).mockResolvedValue({ user } as Awaited<
      ReturnType<typeof openUserDataAccess>
    >);
    getClaims.mockResolvedValue({
      error: null,
      data: { claims: { sub: user.id, session_id: sessionId } },
    });
    vi.mocked(createServiceDataClient).mockReturnValue(client);
  });

  it('deriva usuario y sesión de identidad validada antes de abrir el repositorio privilegiado', async () => {
    const context = await openGmailOAuthData(client);
    expect(context.user).toEqual(user);
    expect(openUserDataAccess).toHaveBeenCalledWith(client);
    expect(createGmailOAuthRepository).toHaveBeenCalledWith(
      client,
      user.id,
      sessionId,
    );
  });

  it.each([
    { error: { status: 401 }, data: null },
    { error: null, data: null },
    {
      error: null,
      data: { claims: { sub: 'another-user', session_id: sessionId } },
    },
    { error: null, data: { claims: { sub: user.id } } },
    { error: null, data: { claims: { sub: user.id, session_id: 'invalid' } } },
  ])(
    'rechaza claims ausentes, manipulados o de otro usuario',
    async (value) => {
      getClaims.mockResolvedValue(value);
      await expect(openGmailOAuthData(client)).rejects.toThrow();
      expect(createServiceDataClient).not.toHaveBeenCalled();
      expect(createGmailOAuthRepository).not.toHaveBeenCalled();
    },
  );

  it('no accede a datos privilegiados si el perfil no está autorizado', async () => {
    vi.mocked(openUserDataAccess).mockRejectedValue(
      new Error('UNAUTHENTICATED'),
    );
    await expect(openGmailOAuthData(client)).rejects.toThrow();
    expect(getClaims).not.toHaveBeenCalled();
    expect(createServiceDataClient).not.toHaveBeenCalled();
  });
});
