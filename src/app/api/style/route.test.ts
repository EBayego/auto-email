import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getStyleEditorAccess } from '@/app/_lib/style-editor';
import { DataAccessError } from '@/db/errors';
import { StyleEditorError } from '@/modules/identity/style-editor';
import { GET, PUT } from './route';
vi.mock('@/app/_lib/style-editor', () => ({ getStyleEditorAccess: vi.fn() }));
const get = vi.fn(),
  apply = vi.fn();
const base = {
  scope: { kind: 'GENERAL', key: '' },
  generalRevision: crypto.randomUUID(),
  profileRevision: crypto.randomUUID(),
  expectedRevisions: [],
};
const request = (body: unknown, origin = 'http://localhost:3000') =>
  new NextRequest('http://localhost:3000/api/style', {
    method: 'PUT',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
describe('MAIL-052 API de estilo autenticada', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    get.mockResolvedValue(null);
    apply.mockResolvedValue(undefined);
    vi.mocked(getStyleEditorAccess).mockResolvedValue({ get, apply });
  });
  it('devuelve un estado privado y un perfil ausente sin inventar datos', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ style: null });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each(['save', 'restore', 'confirm'] as const)(
    'ejecuta %s sobre la sesión verificada',
    async (action) => {
      const body = {
        action,
        ...base,
        ...(action === 'save'
          ? { preferences: [{ key: 'length', value: 'long' }] }
          : {}),
        ...(action === 'confirm' ? { reviewed: true } : {}),
      };
      const response = await PUT(request(body));
      expect(response.status).toBe(200);
      expect(apply).toHaveBeenCalledWith(body);
    },
  );
  it('rechaza otro origen antes de consultar la sesión', async () => {
    expect(
      (
        await PUT(
          request({ action: 'restore', ...base }, 'https://evil.invalid'),
        )
      ).status,
    ).toBe(400);
    expect(getStyleEditorAccess).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'save', ...base, preferences: [], user_id: 'victim' },
    { action: 'confirm', ...base, reviewed: false },
    { action: 'restore', ...base, profileRevision: 'old' },
  ])('valida el cuerpo antes de escribir %j', async (body) => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('rechaza la sesión %s', async (code, status) => {
    vi.mocked(getStyleEditorAccess).mockRejectedValue(
      new DataAccessError(code),
    );
    expect((await GET()).status).toBe(status);
  });
  it.each([
    'STALE_STYLE',
    'STALE_PREFERENCE',
    'CONTEXT_NOT_CURRENT',
    'GENERAL_PROFILE_REQUIRED',
    'NOT_CONNECTED',
  ])('presenta el conflicto %s sin datos internos', async (code) => {
    apply.mockRejectedValue(new StyleEditorError(code));
    const response = await PUT(request({ action: 'restore', ...base }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: code });
  });
});
