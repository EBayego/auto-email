import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getOnboardingAccess } from '@/app/_lib/onboarding';
import { DataAccessError } from '@/db/errors';
import { OnboardingError } from '@/modules/identity/onboarding';
import { GET, POST } from './route';
vi.mock('@/app/_lib/onboarding', () => ({ getOnboardingAccess: vi.fn() }));
const get = vi.fn(),
  apply = vi.fn();
const request = (body: unknown, origin = 'http://localhost:3000') =>
  new NextRequest('http://localhost:3000/api/onboarding', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
describe('MAIL-051 endpoints privados de onboarding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    get.mockResolvedValue(null);
    apply.mockResolvedValue(undefined);
    vi.mocked(getOnboardingAccess).mockResolvedValue({ get, apply });
  });
  it('devuelve únicamente el estado de la sesión con cabeceras privadas', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ onboarding: null });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('encola el análisis con la revisión explícita del consentimiento', async () => {
    const revision = crypto.randomUUID();
    const response = await POST(request({ action: 'start', revision }));
    expect(response.status).toBe(202);
    expect(apply).toHaveBeenCalledWith({ action: 'start', revision });
  });
  it.each([
    {},
    { action: 'consent', consent: false },
    { action: 'start', revision: crypto.randomUUID(), user_id: 'victim' },
  ])('rechaza %j antes de acceder a datos', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(getOnboardingAccess).not.toHaveBeenCalled();
  });
  it('rechaza solicitudes de otro origen', async () => {
    expect(
      (
        await POST(
          request(
            { action: 'start', revision: crypto.randomUUID() },
            'https://evil.invalid',
          ),
        )
      ).status,
    ).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('protege la sesión: %s', async (code, status) => {
    vi.mocked(getOnboardingAccess).mockRejectedValue(new DataAccessError(code));
    expect((await GET()).status).toBe(status);
  });
  it.each([
    'CONSENT_REQUIRED',
    'ANALYSIS_BUSY',
    'STALE_CONSENT',
    'NOT_CONNECTED',
  ] as const)('explica el conflicto %s', async (code) => {
    apply.mockRejectedValue(new OnboardingError(code));
    const response = await POST(
      request({ action: 'start', revision: crypto.randomUUID() }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: code });
  });
});
