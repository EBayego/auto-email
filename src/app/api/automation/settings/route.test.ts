import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from './route';
import { getAutomationSettings } from '@/app/_lib/automation-settings';
import { AutomationSettingsError } from '@/modules/workflow/automation-settings';
import { DataAccessError } from '@/db/errors';
import { defaultResponsePolicySettings } from '@/modules/policy/settings';
vi.mock('@/app/_lib/automation-settings', () => ({
  getAutomationSettings: vi.fn(),
}));
vi.mock('@/modules/auth/config', () => ({
  getAuthConfig: () => ({ appOrigin: 'https://app.invalid' }),
}));
const snapshot = {
  revision: 'a'.repeat(32),
  settings: {
    execution: {
      automationEnabled: false,
      pollIntervalSeconds: 300,
      maxDailyDrafts: 30,
    },
    processingScope: 'ALL_INCOMING',
    excludedAddresses: [],
    excludedDomains: [],
    policy: defaultResponsePolicySettings(),
  },
};
const get = vi.fn(),
  set = vi.fn();
function request(
  body: unknown = snapshot,
  headers: Record<string, string> = {},
) {
  return new NextRequest('https://app.invalid/api/automation/settings', {
    method: 'PUT',
    headers: {
      origin: 'https://app.invalid',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
describe('MAIL-053 API de configuración', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    get.mockResolvedValue(snapshot);
    set.mockResolvedValue(snapshot);
    vi.mocked(getAutomationSettings).mockResolvedValue({ get, set });
  });
  it('devuelve exclusivamente la configuración propia sin caché', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual(snapshot);
  });
  it('guarda una revisión válida', async () => {
    expect((await PUT(request())).status).toBe(200);
    expect(set).toHaveBeenCalledWith(snapshot);
  });
  it.each<Record<string, string>>([
    { origin: 'https://evil.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { 'content-type': 'text/plain' },
    { 'content-length': '65537' },
  ])('rechaza origen, formato o tamaño incorrectos: %j', async (headers) => {
    expect((await PUT(request(snapshot, headers))).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
  it.each([
    { ...snapshot, userId: crypto.randomUUID() },
    { ...snapshot, revision: 'bad' },
    {
      ...snapshot,
      settings: { ...snapshot.settings, processingScope: 'ARBITRARY' },
    },
  ])('rechaza campos o valores ajenos al contrato', async (body) =>
    expect((await PUT(request(body))).status).toBe(400),
  );
  it('expone el conflicto sin sobrescribir', async () => {
    set.mockRejectedValue(new AutomationSettingsError('SETTINGS_CHANGED'));
    const response = await PUT(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'SETTINGS_CHANGED' });
  });
  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['UNAVAILABLE', 503],
  ] as const)('gestiona %s sin filtrar detalles', async (code, status) => {
    vi.mocked(getAutomationSettings).mockRejectedValue(
      new DataAccessError(code),
    );
    expect((await GET()).status).toBe(status);
  });
});
