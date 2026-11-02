import Link from 'next/link';
import { readPrivacyNotice } from '@/modules/privacy/config';
import { PrivacyNoticeContent } from './notice-content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privacidad y condiciones · Auto Email' };
export default function PrivacyPage() {
  const notice = readPrivacyNotice();
  return (
    <main className="privacy-page">
      <Link href="/" className="brand">
        Auto Email
      </Link>
      <h1>Privacidad y condiciones de uso</h1>
      {!notice.ready && (
        <p className="form-message">
          Información pendiente de completar y revisar antes del piloto
          comercial. La aceptación de permisos está deshabilitada.
        </p>
      )}
      <PrivacyNoticeContent identity={notice.identity} />
      <p>
        <Link href="/settings">Gestionar mis permisos y datos</Link>
      </p>
    </main>
  );
}
