import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccount } from '@/app/_lib/auth';
import { GET } from './route';

vi.mock('@/app/_lib/auth', () => ({ getAccount: vi.fn() }));

describe('GET /api/account', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    ['unauthenticated', 401, 'UNAUTHENTICATED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['unavailable', 503, 'AUTH_UNAVAILABLE'],
  ] as const)('rechaza %s sin datos privados', async (status, code, error) => {
    vi.mocked(getAccount).mockResolvedValue({ status });
    const response = await GET();
    expect(response.status).toBe(code);
    expect(await response.json()).toEqual({ error });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('devuelve solo la cuenta de la sesión y evita compartirla en cachés', async () => {
    const account = {
      user: { id: 'a', email: 'a@example.invalid' },
      settings: {
        automationEnabled: false,
        pollIntervalSeconds: 300,
        maxDailyDrafts: 30,
      },
    };
    vi.mocked(getAccount).mockResolvedValue({
      status: 'authenticated',
      account,
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(account);
    expect(response.headers.get('cache-control')).toContain('private');
  });
});
