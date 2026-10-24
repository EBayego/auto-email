import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getExecutionControls } from '@/app/_lib/execution-controls';
import { DataAccessError } from '@/db/errors';
import { POST } from './route';
vi.mock('@/app/_lib/execution-controls', () => ({
  getExecutionControls: vi.fn(),
}));
const settings = vi.fn(),
  account = vi.fn();
const origin = 'http://localhost:3000';
const request = (body = 'action=run', headers: Record<string, string> = {}) =>
  new NextRequest(`${origin}/api/automation`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body,
  });
describe('MAIL-035 controles HTTP autenticados', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getExecutionControls).mockResolvedValue({ settings, account });
    settings.mockResolvedValue(undefined);
    account.mockResolvedValue(undefined);
  });
  it.each(['pause', 'resume', 'run'])(
    'aplica %s al propietario de la sesión',
    async (action) => {
      const response = await POST(request(`action=${action}`));
      expect(response.status).toBe(303);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(account).toHaveBeenCalledWith(action);
      expect(response.headers.get('location')).toBe(
        `${origin}/app?execution=${action === 'run' ? 'QUEUED' : 'SAVED'}`,
      );
    },
  );
  it('guarda límites sin fiarse de campos de identidad', async () => {
    expect(
      (
        await POST(
          request(
            'action=settings&automationEnabled=true&pollIntervalSeconds=120&maxDailyDrafts=5',
          ),
        )
      ).status,
    ).toBe(303);
    expect(settings).toHaveBeenCalledWith({
      automationEnabled: true,
      pollIntervalSeconds: 120,
      maxDailyDrafts: 5,
    });
    expect((await POST(request('action=run&userId=other'))).status).toBe(400);
    expect(account).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { origin: 'https://attacker.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: '' },
  ])('rechaza otro origen antes de acceder a la sesión', async (headers) => {
    expect((await POST(request('action=run', headers))).status).toBe(400);
    expect(getExecutionControls).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('no muta datos si la sesión falla: %s', async (code, status) => {
    vi.mocked(getExecutionControls).mockRejectedValue(
      new DataAccessError(code),
    );
    expect((await POST(request())).status).toBe(status);
    expect(account).not.toHaveBeenCalled();
  });
  it('rechaza JSON y formularios excesivos', async () => {
    expect(
      (await POST(request('{}', { 'content-type': 'application/json' })))
        .status,
    ).toBe(400);
    expect((await POST(request('x'.repeat(2049)))).status).toBe(400);
    expect(getExecutionControls).not.toHaveBeenCalled();
  });
});
