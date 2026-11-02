'use client';
import { useEffect, useState } from 'react';
import {
  generationRetentionSnapshotSchema,
  generationVersion,
  type GenerationRetentionSnapshot,
} from '@/modules/analytics/retention';
import { DateTime, Panel } from '../components';

// No consent or retention changes are submitted while loading the page.
export function GenerationRetentionPanel({
  accountId,
  initial,
}: {
  accountId: string;
  initial?: GenerationRetentionSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initial ?? null),
    [consent, setConsent] = useState(false),
    [hours, setHours] = useState('24'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false);
  const endpoint = `/api/learning/retention?accountId=${encodeURIComponent(accountId)}`;
  async function read() {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('UNAVAILABLE');
    const value = generationRetentionSnapshotSchema.parse(
      await response.json(),
    );
    if (value.accountId !== accountId) throw new Error('UNAVAILABLE');
    return value;
  }
  useEffect(() => {
    if (initial) return;
    let active = true;
    void fetch(endpoint, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('UNAVAILABLE');
        const value = generationRetentionSnapshotSchema.parse(
          await response.json(),
        );
        if (value.accountId !== accountId) throw new Error('UNAVAILABLE');
        return value;
      })
      .then((value) => {
        if (active) {
          setSnapshot(value);
          if (value.enabled) setHours(String(value.retentionHours));
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setMessage(
            'No podemos consultar el permiso de comparación. Vuelve a cargarlo.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [accountId, endpoint, initial]);
  async function submit(enabled: boolean) {
    if (enabled && !consent) return;
    setBusy(true);
    setFailed(false);
    setMessage('');
    try {
      const response = await fetch('/api/learning/retention', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          enabled
            ? {
                accountId,
                enabled: true,
                retentionHours: Number(hours),
                noticeVersion: generationVersion,
              }
            : { accountId, enabled: false },
        ),
      });
      if (!response.ok) throw new Error('UNAVAILABLE');
      setSnapshot(await read());
      setConsent(false);
      setMessage(
        enabled
          ? 'Comparación autorizada para nuevas generaciones.'
          : 'Permiso retirado. Se han eliminado las copias temporales pendientes.',
      );
    } catch {
      setFailed(true);
      setMessage(
        'No se pudo confirmar el cambio. Recarga el estado antes de continuar.',
      );
      setSnapshot(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="Comparar mis correcciones">
      <p className="description">
        Para comparar lo generado con lo que envías en Gmail necesitamos
        conservar temporalmente el texto original. Puede contener datos
        personales y sensibles. Este permiso es opcional y está desactivado por
        defecto.
      </p>
      <p className="description">
        El original deja de estar disponible al vencer el plazo y se purga cada
        cinco minutos; también se elimina al completar la comparación o retirar
        el permiso. No se guardan copias retroactivas. Los resultados conservan
        indicadores de edición, sin los textos comparados.
      </p>
      {message && (
        <p
          className={failed ? 'form-error' : 'form-message'}
          role={failed ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
      {!snapshot ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setSnapshot(await read());
              setFailed(false);
              setMessage('Permiso actualizado.');
            } catch {
              setFailed(true);
              setMessage('No podemos consultar el permiso de comparación.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Cargar permiso de comparación
        </button>
      ) : (
        <>
          <p>
            Estado:{' '}
            <strong>{snapshot.enabled ? 'Activado' : 'Desactivado'}</strong>
            {snapshot.enabled && (
              <>
                {' '}
                · plazo máximo: {snapshot.retentionHours} horas · autorizado el{' '}
                <DateTime value={snapshot.authorizedAt} />
              </>
            )}
          </p>
          <div className="settings-fields">
            <label>
              Plazo máximo en horas
              <input
                type="number"
                min="1"
                max="168"
                step="1"
                value={hours}
                disabled={busy}
                onChange={(event) => setHours(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(event) => setConsent(event.target.checked)}
              />
              Autorizo conservar temporalmente los originales durante este plazo
              para comparar mis correcciones y proponer mejoras de estilo. Aviso{' '}
              {generationVersion}.
            </label>
          </div>
          <div className="workspace-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={
                busy ||
                !consent ||
                !/^\d+$/.test(hours) ||
                Number(hours) < 1 ||
                Number(hours) > 168
              }
              onClick={() => void submit(true)}
            >
              {snapshot.enabled
                ? 'Actualizar plazo autorizado'
                : 'Autorizar comparación'}
            </button>
            {snapshot.enabled && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => void submit(false)}
              >
                Retirar permiso y purgar copias
              </button>
            )}
          </div>
          <p className="field-help">
            Reducir el plazo acorta el de las copias existentes. Ampliarlo solo
            afecta a las nuevas. La aplicación automática de cambios de estilo
            requiere otro permiso en Mi estilo; las propuestas relevantes
            siempre necesitan confirmación.
          </p>
        </>
      )}
    </Panel>
  );
}
