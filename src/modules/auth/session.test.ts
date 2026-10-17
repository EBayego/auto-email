import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './client';
import { resolveAccount } from './session';

function fixture(id = '00000000-0000-4000-8000-000000000001') {
  const user = {
    id,
    email: `${id}@example.invalid`,
    email_confirmed_at: '2026-10-17T00:00:00Z',
    is_anonymous: false,
  };
  const profile = { data: { id, status: 'ACTIVE' }, error: null };
  const settings = {
    data: {
      user_id: id,
      automation_enabled: false,
      poll_interval_seconds: 300,
      max_daily_drafts: 30,
    },
    error: null,
  };
  const profileQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(profile),
  };
  const settingsQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(settings),
  };
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
  const from = vi.fn((table) =>
    table === 'users' ? profileQuery : settingsQuery,
  );
  const client = { auth: { getUser }, from } as unknown as AuthClient;
  return {
    client,
    user,
    profile,
    settings,
    profileQuery,
    settingsQuery,
    getUser,
    from,
  };
}

describe('sesión de aplicación', () => {
  it.each([
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ])(
    'usa exclusivamente la identidad verificada de %s y filtra todas las consultas',
    async (id) => {
      const f = fixture(id);
      expect(await resolveAccount(f.client)).toEqual({
        status: 'authenticated',
        account: {
          user: { id, email: `${id}@example.invalid` },
          settings: {
            automationEnabled: false,
            pollIntervalSeconds: 300,
            maxDailyDrafts: 30,
          },
        },
      });
      expect(f.getUser).toHaveBeenCalledOnce();
      expect(f.profileQuery.eq).toHaveBeenCalledWith('id', id);
      expect(f.settingsQuery.eq).toHaveBeenCalledWith('user_id', id);
      expect(f.from.mock.calls.map(([table]) => table)).toEqual([
        'users',
        'user_settings',
      ]);
    },
  );

  it('rechaza una sesión ausente, manipulada o caducada antes de consultar datos', async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });
    expect(await resolveAccount(f.client)).toEqual({
      status: 'unauthenticated',
    });
    expect(f.from).not.toHaveBeenCalled();
  });

  it.each(['is_anonymous', 'email_confirmed_at', 'email'])(
    'no autoriza identidades anónimas o incompletas (%s)',
    async (field) => {
      const f = fixture();
      f.getUser.mockResolvedValue({
        data: {
          user: { ...f.user, [field]: field === 'is_anonymous' ? true : null },
        },
        error: null,
      });
      expect(await resolveAccount(f.client)).toEqual({
        status: 'unauthenticated',
      });
      expect(f.from).not.toHaveBeenCalled();
    },
  );

  it.each(['DISABLED', 'DELETION_PENDING'])(
    'bloquea cuentas %s sin leer sus ajustes',
    async (status) => {
      const f = fixture();
      f.profile.data.status = status;
      expect(await resolveAccount(f.client)).toEqual({ status: 'forbidden' });
      expect(f.settingsQuery.select).not.toHaveBeenCalled();
    },
  );

  it('no concede acceso si falta la identidad de aplicación', async () => {
    const f = fixture();
    f.profileQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await resolveAccount(f.client)).toEqual({ status: 'forbidden' });
  });

  it('no devuelve ajustes de otro propietario aunque un adaptador se equivoque', async () => {
    const f = fixture();
    f.settings.data.user_id = 'user-b';
    expect(await resolveAccount(f.client)).toEqual({ status: 'unavailable' });
  });

  it('distingue una caída del proveedor de credenciales incorrectas', async () => {
    const f = fixture();
    f.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503 },
    });
    expect(await resolveAccount(f.client)).toEqual({ status: 'unavailable' });
    expect(f.from).not.toHaveBeenCalled();
  });

  it('falla sin datos si la base no responde o faltan ajustes', async () => {
    const f = fixture();
    f.settingsQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await resolveAccount(f.client)).toEqual({ status: 'unavailable' });
    f.profileQuery.maybeSingle.mockRejectedValue(
      new Error('private provider detail'),
    );
    expect(await resolveAccount(f.client)).toEqual({ status: 'unavailable' });
  });
});
