import Link from 'next/link';
import { getPrivacyAccess } from '@/app/_lib/privacy';
import { readPrivacyNotice } from '@/modules/privacy/config';
import { PrivacyNoticeContent } from '@/app/privacy/notice-content';
import { PageHeader, Panel, UnavailableState } from '../components';
import { PrivacyControls } from './privacy-controls';

export const metadata = { title: 'Antes de conectar Gmail · Auto Email' };
export default async function PrivacyConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const notice = readPrivacyNotice();
  const params = await searchParams;
  const status = await getPrivacyAccess()
    .then((access) => access.get())
    .catch(() => null);
  return (
    <>
      <PageHeader
        title="Antes de conectar Gmail"
        description="Revisa qué datos se utilizan y decide si autorizas este uso. Después elegirás los permisos en Google."
      />
      <Panel title="Tu información y tu decisión">
        <PrivacyNoticeContent identity={notice.identity} />
        {status ? (
          <PrivacyControls
            initial={status}
            ready={notice.ready}
            version={notice.version}
            noticeHash={notice.hash}
            connect
            onboarding={params.onboarding === '1'}
          />
        ) : (
          <UnavailableState>
            No podemos consultar tus permisos. Recarga la página para
            reintentar.
          </UnavailableState>
        )}
        <p>
          <Link href={params.onboarding === '1' ? '/onboarding' : '/settings'}>
            Volver sin conectar
          </Link>
        </p>
      </Panel>
    </>
  );
}
