'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, DateTime } from '../components';
const eventLabels: Record<string, string> = {
  GMAIL_DISCONNECTED: 'Gmail desconectado',
  STYLE_DELETED: 'Perfil y preferencias de escritura borrados',
  DOCUMENT_DELETED: 'Documento eliminado',
  ACCOUNT_DELETION_REQUESTED: 'Borrado de cuenta solicitado',
  ACCOUNT_DELETED: 'Borrado de cuenta completado',
};
export function AccountDataControls({ email }: { email: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'style' | 'account' | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [confirmEmail, setConfirmEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    [events, setEvents] = useState<
      { id: string; action: string; created_at: string }[]
    >([]),
    [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/account/lifecycle', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value) => {
        if (active) setEvents(value.events);
      })
      .catch(() => {
        if (active) setHistoryError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit() {
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      const operation =
        mode === 'style'
          ? { action: 'reset_style', confirmation }
          : { action: 'delete_account', confirmation, email: confirmEmail };
      const response = await fetch('/api/account/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(operation),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (mode === 'account') {
        router.replace('/account-deletion');
        router.refresh();
        return;
      }
      setMode(null);
      setConfirmation('');
      setMessage(
        'Perfil y preferencias borrados. La automatización y Gmail han quedado en pausa. Puedes preparar un perfil nuevo desde Primeros pasos.',
      );
      router.refresh();
      const history = await fetch('/api/account/lifecycle', {
        cache: 'no-store',
      });
      if (history.ok) {
        setEvents((await history.json()).events);
        setHistoryError(false);
      }
    } catch (error) {
      setError(true);
      setMessage(
        (error as Error).message === 'INVALID_INPUT'
          ? 'Revisa la confirmación y el correo de la cuenta.'
          : (error as Error).message === 'UNAUTHENTICATED'
            ? 'Tu sesión ha caducado. Inicia sesión de nuevo.'
            : 'No se ha podido completar la operación. Vuelve a intentarlo.',
      );
    } finally {
      setBusy(false);
    }
  }
  const expected = mode === 'style' ? 'BORRAR ESTILO' : 'ELIMINAR MI CUENTA';
  return (
    <Panel title="Tus datos y tu cuenta">
      <p className="description">
        Puedes borrar tu perfil de escritura o solicitar la eliminación de la
        cuenta y de sus datos. Los documentos se eliminan individualmente desde
        la sección de documentos, con su propia confirmación.
      </p>
      {!mode ? (
        <div className="workspace-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setMode('style');
              setConfirmation('');
              setMessage('');
            }}
          >
            Borrar perfil y preferencias de escritura
          </button>
          <button
            className="button button-danger"
            type="button"
            onClick={() => {
              setMode('account');
              setConfirmation('');
              setConfirmEmail('');
              setMessage('');
            }}
          >
            Eliminar mi cuenta y sus datos
          </button>
        </div>
      ) : (
        <form
          className="account-delete-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h3>
            {mode === 'style'
              ? 'Borrar el estilo aprendido'
              : 'Eliminar la cuenta de Auto Email'}
          </h3>
          {mode === 'style' ? (
            <p>
              Se borrarán los perfiles general y contextuales, las preferencias
              de escritura, las relaciones por destinatario y el consentimiento
              del análisis. Se pausará Gmail y se detendrán los trabajos
              pendientes. Tus documentos se conservarán. Esta acción no se puede
              deshacer.
            </p>
          ) : (
            <>
              <p>
                Se desconectará Gmail, se detendrá el procesamiento y se
                eliminarán los perfiles, preferencias, documentos, reglas,
                actividad y la cuenta de acceso. Los correos y borradores de
                Gmail se conservan. Esta acción no se puede deshacer.
              </p>
              <p className="description">
                El borrado de datos activos se completa por pasos y se reintenta
                si falla un servicio. Si hay una carga en curso, esperaremos a
                que termine. Conservarás un resguardo del resultado durante 30
                días, sin contenido de correo ni archivos. Las copias de
                seguridad y los registros de proveedores siguen sus plazos de
                conservación.
              </p>
              <label>
                Correo de tu cuenta de Auto Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={confirmEmail}
                  disabled={busy}
                  onChange={(event) => setConfirmEmail(event.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Escribe {expected} para confirmar
            <input
              type="text"
              autoComplete="off"
              required
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <div className="workspace-actions">
            <button
              className="button button-danger"
              type="submit"
              disabled={
                busy ||
                confirmation !== expected ||
                (mode === 'account' &&
                  confirmEmail.toLowerCase() !== email.toLowerCase())
              }
            >
              {busy
                ? 'Procesando…'
                : mode === 'style'
                  ? 'Sí, borrar mi estilo'
                  : 'Sí, eliminar mi cuenta'}
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              Cancelar borrado
            </button>
          </div>
        </form>
      )}
      {message && (
        <p
          role={error ? 'alert' : 'status'}
          className={error ? 'form-error' : 'form-message'}
        >
          {message}
        </p>
      )}
      <details className="account-audit">
        <summary>Operaciones recientes sobre tus datos</summary>
        <p className="description">
          Se conserva un registro mínimo de estas operaciones durante 30 días,
          sin contenido de correos ni nombres de archivos.
        </p>
        {historyError ? (
          <p className="form-error">
            No se puede consultar este registro. Recarga la página para
            reintentar.
          </p>
        ) : events.length ? (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                {eventLabels[event.action] ?? 'Operación sobre datos'} ·{' '}
                <DateTime value={event.created_at} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="description">No hay operaciones registradas.</p>
        )}
      </details>
    </Panel>
  );
}
