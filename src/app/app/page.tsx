import { redirect } from 'next/navigation';
import { getAccount } from '@/app/_lib/auth';
import { signOut } from '@/app/(auth)/actions';
import { getUserData } from '@/app/_lib/data';
import { gmailOAuthMessages } from '@/modules/gmail/messages';
import { DocumentsPanel } from './documents-panel';

export const metadata = { title: 'Tu cuenta · Auto Email' };
export const dynamic = 'force-dynamic';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; gmail?: string; execution?: string }>;
}) {
  const result = await getAccount();
  if (result.status === 'unauthenticated' || result.status === 'forbidden')
    redirect('/login');
  const { error, gmail, execution } = await searchParams;
  let gmailAccount = null;
  let gmailUnavailable = false;
  if (result.status === 'authenticated') {
    try {
      gmailAccount = await (await getUserData()).gmailAccounts.get();
    } catch {
      gmailUnavailable = true;
    }
  }
  const gmailMessage =
    gmail && Object.hasOwn(gmailOAuthMessages, gmail)
      ? gmailOAuthMessages[gmail as keyof typeof gmailOAuthMessages]
      : null;

  return (
    <main className="account-shell">
      <header className="account-header">
        <span className="brand">Auto Email</span>
        <form action={signOut}>
          <button className="button button-secondary" type="submit">
            Cerrar sesión
          </button>
        </form>
      </header>
      {error === 'signout' && (
        <p className="form-error" role="alert">
          No se ha podido cerrar la sesión. Inténtalo de nuevo.
        </p>
      )}
      {result.status === 'unavailable' ? (
        <p className="form-error" role="alert">
          No podemos cargar tu cuenta en este momento. Vuelve a intentarlo más
          tarde.
        </p>
      ) : (
        <section className="account-content" aria-labelledby="account-title">
          <p className="eyebrow">Tu cuenta</p>
          <h1 id="account-title">Todo empieza contigo.</h1>
          <p className="intro">{result.account.user.email}</p>
          <p className="description">
            Conecta Gmail para permitir la lectura de correos y la preparación
            de borradores.
          </p>
          {gmailMessage && (
            <p role="status" className="description">
              {gmailMessage}
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
          {execution === 'SAVED' && (
            <p role="status" className="description">
              Configuración guardada.
            </p>
          )}
          {execution === 'QUEUED' && (
            <p role="status" className="description">
              Revisión solicitada. Se ejecutará cuando el servicio esté
              disponible, con los mismos controles de seguridad y límite diario.
            </p>
          )}
          {gmailUnavailable ? (
            <p role="alert" className="form-error">
              No podemos consultar tu conexión con Gmail en este momento.
            </p>
          ) : (
            <p className="description">
              {gmailAccount
                ? `Cuenta Gmail: ${gmailAccount.email} · ${{ CONNECTED: 'Conectada', DISCONNECTED: 'Desconectada', REAUTH_REQUIRED: 'Necesita autorización', PAUSED: 'Pausada' }[gmailAccount.status] ?? 'No disponible'}`
                : 'Todavía no has conectado una cuenta Gmail.'}
            </p>
          )}
          {gmailAccount?.status === 'REAUTH_REQUIRED' && (
            <p role="alert" className="form-error">
              {gmailOAuthMessages.REAUTH_REQUIRED}
            </p>
          )}
          <a className="button" href="/api/gmail/connect">
            {gmailAccount ? 'Volver a conectar Gmail' : 'Conectar Gmail'}
          </a>
          {gmailAccount?.status === 'CONNECTED' && (
            <>
              <form action="/api/automation" method="post">
                <button
                  className="button button-secondary"
                  name="action"
                  value="pause"
                  type="submit"
                >
                  Pausar cuenta Gmail
                </button>
              </form>
              <form action="/api/automation" method="post">
                <button
                  className="button button-secondary"
                  name="action"
                  value="run"
                  type="submit"
                >
                  Revisar correos ahora
                </button>
              </form>
              <form action="/api/gmail/check" method="post">
                <button className="button button-secondary" type="submit">
                  Comprobar conexión
                </button>
              </form>
            </>
          )}
          {gmailAccount?.status === 'PAUSED' && (
            <form action="/api/automation" method="post">
              <button
                className="button button-secondary"
                name="action"
                value="resume"
                type="submit"
              >
                Reactivar cuenta Gmail
              </button>
            </form>
          )}
          {gmailAccount && (
            <form action="/api/gmail/disconnect" method="post">
              <button className="button button-secondary" type="submit">
                Desconectar Gmail y revocar acceso
              </button>
            </form>
          )}
          <dl className="settings-list">
            <div>
              <dt>Automatización</dt>
              <dd>
                {result.account.settings.automationEnabled
                  ? 'Activada'
                  : 'Desactivada'}
              </dd>
            </div>
            <div>
              <dt>Intervalo de comprobación</dt>
              <dd>{result.account.settings.pollIntervalSeconds} segundos</dd>
            </div>
            <div>
              <dt>Límite diario de borradores</dt>
              <dd>{result.account.settings.maxDailyDrafts}</dd>
            </div>
          </dl>
          <form
            action="/api/automation"
            method="post"
            className="execution-form"
          >
            <input type="hidden" name="action" value="settings" />
            <label>
              <input
                type="checkbox"
                name="automationEnabled"
                value="true"
                defaultChecked={result.account.settings.automationEnabled}
              />{' '}
              Automatización activada
            </label>
            <label>
              Intervalo de comprobación (segundos)
              <input
                type="number"
                name="pollIntervalSeconds"
                min="60"
                max="86400"
                required
                defaultValue={result.account.settings.pollIntervalSeconds}
              />
            </label>
            <label>
              Límite de borradores por día (UTC)
              <input
                type="number"
                name="maxDailyDrafts"
                min="0"
                max="1000"
                required
                defaultValue={result.account.settings.maxDailyDrafts}
              />
            </label>
            <p className="description">
              Un límite de 0 impide crear borradores. La revisión manual no
              activa la automatización y respeta este límite.
            </p>
            <button className="button button-secondary" type="submit">
              Guardar ajustes
            </button>
          </form>
          <DocumentsPanel />
          <p className="description">
            La revisión y el envío de tus respuestas siempre estarán en tus
            manos.
          </p>
        </section>
      )}
    </main>
  );
}
