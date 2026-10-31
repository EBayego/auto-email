'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DeletionStatus } from '@/modules/account/lifecycle';
const phases = {
  REVOKE: 'Retirando el acceso a Gmail',
  FILES: 'Eliminando archivos',
  DATA: 'Eliminando los datos del servicio',
  AUTH: 'Eliminando la cuenta de acceso',
  COMPLETED: 'Eliminación completada',
};
export function DeletionStatusScreen() {
  const [status, setStatus] = useState<DeletionStatus | null>(null),
    [message, setMessage] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await fetch('/api/account/deletion', {
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(
            response.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE',
          );
        const value: DeletionStatus = await response.json();
        if (active) {
          setStatus(value);
          setMessage('');
          if (value.status !== 'COMPLETED')
            timer = setTimeout(() => void poll(), 3000);
        }
      } catch (error) {
        if (active)
          setMessage(
            (error as Error).message === 'NOT_FOUND'
              ? 'No se encuentra un resguardo de eliminación en este navegador. Puede haber caducado o haberse borrado sus cookies.'
              : 'No se puede consultar el resultado en este momento. El proceso registrado seguirá pendiente para reintento.',
          );
      }
    }
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [retry]);
  return (
    <main className="account-deletion-page">
      <Link className="brand" href="/">
        Auto Email
      </Link>
      <section className="workspace-panel">
        <h1>
          {status?.status === 'COMPLETED'
            ? 'Tu cuenta se ha eliminado.'
            : 'Eliminación de tu cuenta.'}
        </h1>
        {status ? (
          <>
            <p role="status">
              {status.status === 'COMPLETED'
                ? 'Se han eliminado los datos activos y la cuenta de acceso de Auto Email. Tus correos y borradores siguen en Gmail.'
                : status.status === 'RETRY'
                  ? 'El borrado está pendiente de reintento automático. El acceso a Gmail y el procesamiento permanecen detenidos.'
                  : status.status === 'QUEUED'
                    ? 'Solicitud recibida. El acceso a Gmail y el procesamiento están detenidos; el borrado está en cola.'
                    : phases[status.phase]}
            </p>
            {status.revocation === 'UNCONFIRMED' && (
              <p className="form-message">
                No hemos podido confirmar la revocación en Google. Retira
                también Auto Email desde{' '}
                <a
                  href="https://myaccount.google.com/connections"
                  target="_blank"
                  rel="noreferrer"
                >
                  los permisos de tu cuenta Google
                </a>
                .
              </p>
            )}
            <p className="description">
              Referencia del resguardo: {status.id}. Este resguardo está
              disponible en este navegador durante 30 días. No contiene correos,
              documentos ni credenciales.
            </p>
            {status.status === 'COMPLETED' && (
              <Link className="button button-secondary" href="/login">
                Volver al inicio de sesión
              </Link>
            )}
          </>
        ) : (
          !message && <p role="status">Consultando el resultado…</p>
        )}
        {message && (
          <>
            <p className="form-error" role="alert">
              {message}
            </p>
            <button
              className="button button-secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Volver a consultar
            </button>
          </>
        )}
      </section>
    </main>
  );
}
