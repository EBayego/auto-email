import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrivacyControls } from './privacy-controls';
import { PrivacyNoticeContent } from '@/app/privacy/notice-content';
import type { PrivacyStatus } from '@/modules/privacy/notice';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const initial: PrivacyStatus = {
  authorized: false,
  acceptedAt: null,
  withdrawnAt: null,
  version: null,
  events: [],
};
describe('MAIL-061 controles visibles de privacidad', () => {
  it('no acepta al cargar, muestra el alcance y requiere marcar el permiso', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const html = renderToStaticMarkup(
      <>
        <PrivacyNoticeContent identity={null} />
        <PrivacyControls
          initial={initial}
          ready
          version="mail061-v1"
          noticeHash={'a'.repeat(64)}
          connect
        />
      </>,
    );
    expect(html).toContain('Supabase');
    expect(html).toContain('Limited Use');
    expect(html).toContain('disabled="">Autorizar y continuar con Google');
    expect(html).not.toContain('checked=""');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('deja retirar un permiso antiguo incluso con la configuración bloqueada', () => {
    const html = renderToStaticMarkup(
      <PrivacyControls
        initial={{
          ...initial,
          acceptedAt: '2026-10-31T10:00:00Z',
          version: 'mail061-v1',
        }}
        ready={false}
        version="mail061-v1"
        noticeHash={'a'.repeat(64)}
        allowGrant={false}
      />,
    );
    expect(html).toContain('Retirar autorización y detener procesamiento');
    expect(html).not.toContain('type="checkbox"');
  });
});
