import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';
import { getAccountLifecycle } from '@/app/_lib/account-lifecycle';
import { createAccountDeletionRuntime } from '@/db/account-deletion-runtime';
import { DataAccessError } from '@/db/errors';
vi.mock('@/app/_lib/account-lifecycle', () => ({
  getAccountLifecycle: vi.fn(),
}));
vi.mock('@/db/account-deletion-runtime', () => ({
  createAccountDeletionRuntime: vi.fn(),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: vi.fn(),
}));
vi.mock('@/modules/auth/config', () => ({
  getAuthConfig: () => ({ appOrigin: 'https://app.invalid' }),
}));
const get = vi.fn(),
  resetStyle = vi.fn(),
  requestDeletion = vi.fn(),
  revokeSessions = vi.fn();
const reset = { action: 'reset_style', confirmation: 'BORRAR ESTILO' },
  remove = {
    action: 'delete_account',
    confirmation: 'ELIMINAR MI CUENTA',
    email: 'owner@example.invalid',
  };
function request(body: unknown = reset, headers: Record<string, string> = {}) {
  return new NextRequest('https://app.invalid/api/account/lifecycle', {
    method: 'POST',
    headers: {
      origin: 'https://app.invalid',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
describe('MAIL-055 acciones de cuenta autenticadas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    get.mockResolvedValue({ profileCount: 0, events: [] });
    resetStyle.mockResolvedValue(undefined);
    requestDeletion.mockResolvedValue('00000000-0000-4000-8000-000000000055');
    revokeSessions.mockResolvedValue(undefined);
    vi.mocked(getAccountLifecycle).mockResolvedValue({
      get,
      resetStyle,
      requestDeletion,
      revokeSessions,
      email: 'owner@example.invalid',
    });
    vi.mocked(createAccountDeletionRuntime).mockReturnValue(vi.fn());
  });
  it('consulta el registro propio con cabeceras privadas', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('borra estilo únicamente con confirmación exacta', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(resetStyle).toHaveBeenCalledOnce();
    expect(requestDeletion).not.toHaveBeenCalled();
  });
  it('registra una baja con resguardo HttpOnly y revoca sesiones sin exponer credenciales', async () => {
    const response = await POST(request(remove));
    expect(response.status).toBe(202);
    expect(response.cookies.get('account-deletion-receipt')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 30 * 86400,
    });
    const body = await response.json();
    expect(body).toEqual({
      status: 'QUEUED',
      requestId: '00000000-0000-4000-8000-000000000055',
    });
    expect(requestDeletion).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(revokeSessions).toHaveBeenCalledOnce();
  });
  it.each([
    { ...remove, email: 'other@example.invalid' },
    { ...remove, confirmation: 'yes' },
    { ...reset, userId: crypto.randomUUID() },
    { action: 'delete_account' },
  ])('rechaza confirmaciones ajenas o incompletas %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(requestDeletion).not.toHaveBeenCalled();
    expect(resetStyle).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { origin: 'https://evil.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { 'content-type': 'text/plain' },
    { 'content-length': '2049' },
  ])('valida el origen y el tamaño antes de escribir', async (headers) => {
    expect((await POST(request(remove, headers))).status).toBe(400);
    expect(getAccountLifecycle).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('gestiona %s', async (code, status) => {
    vi.mocked(getAccountLifecycle).mockRejectedValue(new DataAccessError(code));
    expect((await POST(request())).status).toBe(status);
  });
});
