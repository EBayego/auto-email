import { gmailOAuthMessages } from '@/modules/gmail/messages';

export type WorkspaceSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export function Notices({
  params,
}: {
  params: Awaited<WorkspaceSearchParams>;
}) {
  const gmail = typeof params.gmail === 'string' ? params.gmail : '';
  const message = Object.hasOwn(gmailOAuthMessages, gmail)
    ? gmailOAuthMessages[gmail as keyof typeof gmailOAuthMessages]
    : null;
  return (
    <>
      {params.error === 'signout' && (
        <p className="form-error" role="alert">
          No se ha podido cerrar la sesión. Inténtalo de nuevo.
        </p>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
          {gmail === 'REVOCATION_FAILED' && (
            <>
              {' '}
              <a
                href="https://myaccount.google.com/connections"
                target="_blank"
                rel="noreferrer"
              >
                Revisar permisos en Google
              </a>
            </>
          )}
        </p>
      )}
      {params.execution === 'SAVED' && (
        <p className="form-message" role="status">
          Configuración guardada.
        </p>
      )}
      {params.execution === 'QUEUED' && (
        <p className="form-message" role="status">
          Revisión solicitada. Se ejecutará cuando el servicio esté disponible,
          con los mismos controles de seguridad y límite diario.
        </p>
      )}
    </>
  );
}
