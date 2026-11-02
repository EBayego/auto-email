import Link from 'next/link';
import { getPrivacyAccess } from '@/app/_lib/privacy';
import { readPrivacyNotice } from '@/modules/privacy/config';
import { Panel, UnavailableState } from '../components';
import { PrivacyControls } from '../privacy-consent/privacy-controls';

export async function PrivacyPanel() {
  const notice = readPrivacyNotice();
  const status = await getPrivacyAccess()
    .then((access) => access.get())
    .catch(() => null);
  return (
    <Panel title="Privacidad y autorizaciones">
      <p>
        Puedes detener el uso de Gmail, consultar la información aceptada y
        obtener una copia de tus datos. La retirada no elimina tu cuenta; puedes
        solicitar su borrado más abajo.
      </p>
      <p>
        <Link href="/privacy-consent">
          Leer la información y gestionar mi autorización
        </Link>{' '}
        · <Link href="/privacy">Privacidad y condiciones</Link>
      </p>
      {status ? (
        <PrivacyControls
          initial={status}
          ready={notice.ready}
          version={notice.version}
          noticeHash={notice.hash}
          allowGrant={false}
        />
      ) : (
        <UnavailableState>
          No podemos consultar tus autorizaciones.
        </UnavailableState>
      )}
      <p>
        <a className="button button-secondary" href="/api/privacy/export">
          Descargar mis datos
        </a>
      </p>
      <p className="description">
        Incluye configuración, perfiles, documentos en texto, referencias,
        métricas y registro de privacidad. Los archivos originales se descargan
        desde Conocimiento. No incluye credenciales ni copia de tu buzón. Si la
        descarga no puede completarse, contacta con el operador desde la página
        de privacidad para ejercer tu derecho de acceso.
      </p>
    </Panel>
  );
}
