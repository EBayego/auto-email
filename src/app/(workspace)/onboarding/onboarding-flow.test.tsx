import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingFlow } from './onboarding-flow';
import type { GmailAccount } from '@/db/models';
import type { OnboardingRecord } from '@/modules/identity/onboarding';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const gmail: GmailAccount = {
  id: crypto.randomUUID(),
  user_id: crypto.randomUUID(),
  email: 'owner@example.invalid',
  status: 'CONNECTED',
  scope_set: [],
  last_sync_at: null,
};
const record: OnboardingRecord = {
  consent_revision: crypto.randomUUID(),
  consent_version: 'mail051-v1',
  consented_at: '2026-10-31T09:00:00Z',
  scope: {
    after: '2026-01-01',
    before: '2026-10-30',
    maxCandidates: 200,
    excludedAddresses: [],
    excludedDomains: [],
  },
  status: 'CONSENTED',
  scanned: 0,
  selected: 0,
  profile_revision: null,
  error_code: null,
  lease_expires_at: null,
  started_at: null,
  finished_at: null,
};
const render = (initial: OnboardingRecord | null, account = gmail) =>
  renderToStaticMarkup(
    <OnboardingFlow gmail={account} initial={initial} today="2026-10-31" />,
  );
describe('MAIL-051 estados del onboarding', () => {
  it('no permite iniciar análisis antes de guardar consentimiento', () => {
    const html = render(null);
    expect(html).not.toContain('Iniciar análisis del historial');
    expect(html).toContain('Guardar alcance y consentimiento');
  });
  it('no bloquea un reintento después de volver a conectar Gmail', () => {
    const html = render({
      ...record,
      status: 'FAILED',
      error_code: 'REAUTH_REQUIRED',
    });
    const retry = html.match(/<button[^>]*>Reintentar análisis<\/button>/)?.[0];
    expect(retry).toBeDefined();
    expect(retry).not.toContain('disabled');
    expect(html).toContain('href="/privacy-consent?onboarding=1"');
  });
  it('solicita reconexión y bloquea el análisis si Gmail aún necesita autorización', () => {
    const html = render(
      { ...record, status: 'FAILED', error_code: 'REAUTH_REQUIRED' },
      { ...gmail, status: 'REAUTH_REQUIRED' },
    );
    expect(
      html.match(/<button[^>]*>Reintentar análisis<\/button>/)?.[0],
    ).toContain('disabled');
    expect(html).toContain('Volver a conectar Gmail');
  });
  it('muestra el progreso persistido y permite cancelar', () => {
    const html = render({ ...record, status: 'SAMPLING', scanned: 32 });
    expect(html).toContain('Preparando la muestra: 32 mensajes examinados');
    expect(html).toContain('Cancelar análisis');
    expect(html).toContain('aria-live="polite"');
  });
  it('advierte de la muestra pequeña y de la revisión pendiente al completar', () => {
    const html = render({
      ...record,
      status: 'COMPLETED',
      selected: 3,
      scanned: 3,
    });
    expect(html).toContain('menos de los 200 ejemplos recomendados');
    expect(html).toContain('pendiente de revisión');
    expect(html).toContain('Consultar mi perfil');
  });
});
