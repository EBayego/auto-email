import {
  privacyNoticeVersion,
  privacySections,
} from '@/modules/privacy/notice';
import { serviceContactEmail } from '@/config/contact';

export function PrivacyNoticeContent({
  identity,
}: {
  identity: {
    operator: string;
    email: string;
    address: string;
    hosting: string;
    processing: string;
  } | null;
}) {
  return (
    <div className="privacy-notice">
      <p className="eyebrow">
        Información de privacidad · {privacyNoticeVersion}
      </p>
      {identity ? (
        <section aria-label="Operador del servicio">
          <h2>Quién opera Auto Email</h2>
          <p>
            {identity.operator} · {identity.address}
          </p>
          <p>
            Contacto de privacidad:{' '}
            <a href={`mailto:${identity.email}`}>{identity.email}</a>
          </p>
          <p>Alojamiento de la aplicación: {identity.hosting}</p>
          <p className="privacy-processing">{identity.processing}</p>
        </section>
      ) : (
        <section>
          <p role="status" className="form-message">
            La identidad del operador todavía está pendiente de completar y
            revisar. No se pueden conceder nuevas autorizaciones de Gmail.
          </p>
          <p>
            Contacto de soporte y privacidad:{' '}
            <a href={`mailto:${serviceContactEmail}`}>{serviceContactEmail}</a>
          </p>
        </section>
      )}
      {privacySections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          <p>{section.text}</p>
        </section>
      ))}
      <p>
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy (Limited Use)
        </a>{' '}
        ·{' '}
        <a
          href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy"
          target="_blank"
          rel="noreferrer"
        >
          Política de datos de Google Workspace
        </a>{' '}
        ·{' '}
        <a
          href="https://myaccount.google.com/connections"
          target="_blank"
          rel="noreferrer"
        >
          Gestionar el acceso en Google
        </a>
      </p>
    </div>
  );
}
