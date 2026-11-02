'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PrivacyStatus } from '@/modules/privacy/notice';
import { privacyGrantText } from '@/modules/privacy/notice';
import { DateTime } from '../components';

export function PrivacyControls({
  initial,
  ready,
  version,
  noticeHash,
  connect = false,
  onboarding = false,
  allowGrant = true,
}: {
  initial: PrivacyStatus;
  ready: boolean;
  version: string;
  noticeHash: string;
  connect?: boolean;
  onboarding?: boolean;
  allowGrant?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false);
  const endpoint = `/api/gmail/connect?authorized=1${onboarding ? '&onboarding=1' : ''}`;
  async function apply(action: 'grant' | 'withdraw') {
    if (action === 'grant' && (!ready || !checked)) return;
    setBusy(true);
    setFailed(false);
    setMessage('');
    try {
      const response = await fetch('/api/privacy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          action === 'grant'
            ? { action, version, noticeHash, consent: true }
            : { action },
        ),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setStatus(body);
      setChecked(false);
      setMessage(
        action === 'grant'
          ? 'Autorización registrada. Las opciones de comparación y aprendizaje siguen requiriendo sus propios permisos.'
          : 'Autorización retirada. Gmail está en pausa y se han detenido los trabajos y los permisos opcionales. Puedes desconectar Google o solicitar el borrado desde Ajustes.',
      );
      if (action === 'grant' && connect)
        window.location.assign(new URL(endpoint, window.location.origin).href);
      else router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(
        (error as Error).message === 'STALE_PRIVACY_NOTICE'
          ? 'El texto ha cambiado. Recarga la página y revísalo antes de aceptar.'
          : (error as Error).message === 'PRIVACY_CONFIGURATION_REQUIRED'
            ? 'La información del operador está pendiente de completar y revisar.'
            : 'No se ha podido confirmar el cambio. Recarga el estado antes de continuar.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="privacy-controls">
      <p>
        <strong>
          {status.authorized
            ? 'Autorización vigente'
            : status.withdrawnAt
              ? 'Autorización retirada'
              : 'Autorización pendiente'}
        </strong>
        {status.acceptedAt && (
          <>
            {' '}
            · Aceptada el <DateTime value={status.acceptedAt} />
          </>
        )}
      </p>
      {!ready && (
        <p role="status">
          La conexión está bloqueada hasta completar la información del operador
          y su revisión.
        </p>
      )}
      {!status.authorized && allowGrant && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void apply('grant');
          }}
        >
          <label className="privacy-checkbox">
            <input
              type="checkbox"
              checked={checked}
              disabled={!ready || busy}
              onChange={(event) => setChecked(event.target.checked)}
            />
            {privacyGrantText}
          </label>
          <button
            className="button"
            type="submit"
            disabled={!ready || !checked || busy}
          >
            {busy
              ? 'Guardando…'
              : connect
                ? 'Autorizar y continuar con Google'
                : 'Autorizar el uso descrito'}
          </button>
        </form>
      )}
      {!!status.acceptedAt && !status.withdrawnAt && (
        <div className="workspace-actions">
          {connect && ready && (
            <a className="button" href={endpoint}>
              Continuar con Google
            </a>
          )}
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => void apply('withdraw')}
          >
            {busy
              ? 'Retirando…'
              : 'Retirar autorización y detener procesamiento'}
          </button>
        </div>
      )}
      {message && (
        <p
          role={failed ? 'alert' : 'status'}
          className={failed ? 'form-error' : 'form-message'}
        >
          {message}
        </p>
      )}
      {!!status.events.length && (
        <details className="account-audit">
          <summary>Historial de autorizaciones</summary>
          <ul>
            {status.events.map((event) => (
              <li key={event.id}>
                {event.action === 'GRANTED' ? 'Autorizada' : 'Retirada'} ·{' '}
                {event.notice_version} · <DateTime value={event.created_at} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
