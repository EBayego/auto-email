import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { createServerAuthClient } from '@/app/_lib/auth';
import { resolveAccount } from '@/modules/auth/session';
import { signIn, signOut, signUp } from './actions';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock('@/app/_lib/auth', () => ({ createServerAuthClient: vi.fn() }));
vi.mock('@/modules/auth/session', () => ({ resolveAccount: vi.fn() }));
vi.mock('@/modules/auth/config', () => ({
  getAuthConfig: () => ({ appOrigin: 'https://app.example.com' }),
}));

function credentials() {
  const data = new FormData();
  data.set('email', 'a@example.invalid');
  data.set('password', 'test password');
  data.set('user_id', 'victim');
  return data;
}

const auth = { signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn() };

describe('acciones de autenticación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServerAuthClient).mockResolvedValue({
      auth,
    } as unknown as Awaited<ReturnType<typeof createServerAuthClient>>);
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it('no envía credenciales malformadas al proveedor', async () => {
    expect(await signIn({}, new FormData())).toHaveProperty('error');
    expect(createServerAuthClient).not.toHaveBeenCalled();
  });

  it('solo redirige tras verificar también el estado de la cuenta', async () => {
    vi.mocked(resolveAccount).mockResolvedValue({
      status: 'authenticated',
      account: {
        user: { id: 'a', email: 'a@example.invalid' },
        settings: {
          automationEnabled: false,
          pollIntervalSeconds: 300,
          maxDailyDrafts: 30,
        },
      },
    });
    await expect(signIn({}, credentials())).rejects.toThrow('redirect:/app');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@example.invalid',
      password: 'test password',
    });
    expect(createServerAuthClient).toHaveBeenCalledWith(true);
  });

  it('cierra la nueva sesión de una cuenta deshabilitada', async () => {
    vi.mocked(resolveAccount).mockResolvedValue({ status: 'forbidden' });
    expect(await signIn({}, credentials())).toHaveProperty('error');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('no filtra mensajes del proveedor ni identifica si existe un correo', async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { status: 400, message: 'sensitive internal detail' },
    });
    const result = await signIn({}, credentials());
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(resolveAccount).not.toHaveBeenCalled();
  });

  it('fija el callback del registro al origen configurado y no acepta propietarios del formulario', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect(await signUp({}, credentials())).toHaveProperty('message');
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'a@example.invalid',
      password: 'test password',
      options: { emailRedirectTo: 'https://app.example.com/auth/callback' },
    });
  });

  it('cierra solo la sesión web actual mediante el proveedor', async () => {
    await expect(signOut()).rejects.toThrow('redirect:/login');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('no afirma que cerró sesión si la revocación falla', async () => {
    auth.signOut.mockResolvedValue({ error: { status: 503 } });
    await expect(signOut()).rejects.toThrow('redirect:/app?error=signout');
  });
});
