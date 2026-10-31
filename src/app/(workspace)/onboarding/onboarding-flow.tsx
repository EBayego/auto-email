'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { GmailAccount } from '@/db/models';
import {
  activeAnalysisStates,
  onboardingConsentVersion,
  onboardingMessages,
  type OnboardingRecord,
  type OnboardingOperation,
} from '@/modules/identity/onboarding';
import { DateTime, GmailSummary, Panel } from '../components';

export function OnboardingFlow({
  gmail,
  initial,
  today,
}: {
  gmail: GmailAccount | null;
  initial: OnboardingRecord | null;
  today: string;
}) {
  const [record, setRecord] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageStage, setMessageStage] = useState<'consent' | 'analysis'>(
    'analysis',
  );
  const [consented, setConsented] = useState(false);
  const [dirty, setDirty] = useState(!initial);
  const router = useRouter();
  const active = !!record && activeAnalysisStates.includes(record.status);
  const connected = gmail?.status === 'CONNECTED';
  const needsOAuth =
    !gmail || ['DISCONNECTED', 'REAUTH_REQUIRED'].includes(gmail.status);
  const defaultAfter = new Date(`${today}T00:00:00Z`);
  defaultAfter.setUTCDate(defaultAfter.getUTCDate() - 90);
  async function readResponse(response: Response) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setRecord(body.onboarding);
    return body.onboarding as OnboardingRecord | null;
  }
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/onboarding', { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error();
        if (!stopped) {
          setRecord(body.onboarding);
          setMessage('');
          if (
            ['NOT_CONNECTED', 'REAUTH_REQUIRED'].includes(
              body.onboarding?.error_code,
            )
          )
            router.refresh();
        }
      } catch {
        if (!stopped) {
          setMessageStage('analysis');
          setMessage(
            'No podemos actualizar el progreso. Lo intentaremos de nuevo en unos segundos.',
          );
        }
      }
      if (!stopped) timeout = setTimeout(poll, 3000);
    };
    timeout = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(timeout);
    };
  }, [active, record?.consent_revision, router]);
  async function send(operation: OnboardingOperation) {
    setBusy(true);
    setMessage('');
    setMessageStage(operation.action === 'consent' ? 'consent' : 'analysis');
    try {
      const result = await readResponse(
        await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(operation),
        }),
      );
      if (operation.action === 'consent') {
        setDirty(false);
        setConsented(false);
        if (needsOAuth)
          window.location.assign(
            new URL('/api/gmail/connect?onboarding=1', window.location.origin)
              .href,
          );
      }
      return result;
    } catch (error) {
      if (
        ['NOT_CONNECTED', 'REAUTH_REQUIRED'].includes((error as Error).message)
      )
        router.refresh();
      setMessage(
        onboardingMessages[(error as Error).message] ??
          onboardingMessages.UNAVAILABLE,
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const list = (name: string) => [
      ...new Set(
        String(data.get(name) ?? '')
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map((value) => value.toLowerCase()),
      ),
    ];
    await send({
      action: 'consent',
      consent: true,
      version: onboardingConsentVersion,
      scope: {
        after: String(data.get('after')),
        before: String(data.get('before')),
        maxCandidates: Number(data.get('maxCandidates')) as 200 | 500,
        excludedAddresses: list('excludedAddresses'),
        excludedDomains: list('excludedDomains'),
      },
    });
  }
  return (
    <>
      <ol className="onboarding-steps" aria-label="Progreso de configuración">
        <li aria-current={!record || dirty ? 'step' : undefined}>
          <span>01</span>Consentimiento y alcance
          {record && !dirty && <small>Guardado</small>}
        </li>
        <li aria-current={record && !dirty && !connected ? 'step' : undefined}>
          <span>02</span>Conexión con Gmail
          <small>{connected ? 'Conectada' : 'Pendiente'}</small>
        </li>
        <li aria-current={record && !dirty && connected ? 'step' : undefined}>
          <span>03</span>Aprender tu estilo
          <small>
            {record?.status === 'COMPLETED'
              ? 'Completado'
              : active
                ? 'En curso'
                : 'Pendiente'}
          </small>
        </li>
      </ol>
      <Panel title="01 · Tú decides qué analizamos">
        <p className="description">
          Seleccionaremos hasta 200 ejemplos útiles de tus correos enviados para
          aprender cómo redactas: tono, longitud, saludos y estructura. Para
          preparar respuestas, el asistente también necesitará leer los mensajes
          y conversaciones que deba atender.
        </p>
        <p className="description">
          Los fragmentos de escritura se procesan con OpenAI para crear un
          perfil individual. Los cuerpos de correo se mantienen solo en memoria
          durante el análisis; guardamos el perfil derivado, las referencias
          necesarias a los mensajes y los contadores del proceso en Supabase. No
          se usan tus correos para entrenar un modelo compartido entre usuarios.
        </p>
        <p className="description">
          Google solicitará lectura de Gmail y gestión de borradores. Este
          último permiso también permite enviar, pero Auto Email solo prepara
          borradores: tú los revisas y envías desde Gmail.
        </p>
        <form className="execution-form onboarding-form" onSubmit={save}>
          <fieldset
            disabled={busy || active}
            onChange={() => {
              setDirty(true);
              setConsented(false);
            }}
            onInput={() => {
              setDirty(true);
              setConsented(false);
            }}
            key={record?.consent_revision ?? 'new'}
          >
            <legend>Alcance del historial de enviados</legend>
            <div className="onboarding-dates">
              <label>
                Desde (incluido)
                <input
                  type="date"
                  name="after"
                  min="1970-01-02"
                  max={today}
                  required
                  defaultValue={
                    record?.scope.after ??
                    defaultAfter.toISOString().slice(0, 10)
                  }
                />
              </label>
              <label>
                Hasta (sin incluir)
                <input
                  type="date"
                  name="before"
                  min="1970-01-03"
                  max={today}
                  required
                  defaultValue={record?.scope.before ?? today}
                />
              </label>
            </div>
            <p className="description">
              Las fechas se aplican en UTC. Solo se analizarán enviados dentro
              de este intervalo; se excluyen borradores, papelera, spam,
              respuestas automáticas y texto citado.
            </p>
            <label>
              Máximo de mensajes que podemos examinar
              <select
                name="maxCandidates"
                defaultValue={record?.scope.maxCandidates ?? 200}
              >
                <option value="200">200 mensajes</option>
                <option value="500">500 mensajes</option>
              </select>
            </label>
            <label>
              Excluir correos de estos contactos (opcional)
              <textarea
                name="excludedAddresses"
                maxLength={10000}
                rows={3}
                placeholder="contacto@ejemplo.com"
                defaultValue={record?.scope.excludedAddresses.join('\n') ?? ''}
              />
            </label>
            <label>
              Excluir estos dominios (opcional)
              <textarea
                name="excludedDomains"
                maxLength={10000}
                rows={3}
                placeholder="ejemplo.com"
                defaultValue={record?.scope.excludedDomains.join('\n') ?? ''}
              />
            </label>
            <p className="description">
              Separa las direcciones o dominios con comas o saltos de línea. Se
              omiten mensajes con cualquiera de esos participantes y, para los
              dominios, también sus subdominios.
            </p>
          </fieldset>
          {record?.status === 'COMPLETED' && (
            <p className="description">
              Guardar un nuevo alcance te permitirá repetir el análisis. Si lo
              inicias, el nuevo perfil sustituirá al anterior y quedará
              pendiente de revisión.
            </p>
          )}
          <label className="consent-label">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              disabled={busy || active}
              required
            />
            Autorizo el análisis de mis enviados en este alcance y el
            procesamiento de los fragmentos con OpenAI para obtener mi perfil
            individual de escritura.
          </label>
          {message && messageStage === 'consent' && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          <button
            className="button"
            type="submit"
            disabled={busy || active || !consented}
          >
            {busy
              ? 'Guardando…'
              : needsOAuth
                ? 'Aceptar y conectar Gmail'
                : 'Guardar alcance y consentimiento'}
          </button>
        </form>
        {record && (
          <p className="description">
            Consentimiento guardado: <DateTime value={record.consented_at} />.
          </p>
        )}
      </Panel>
      <Panel title="02 · Confirma tu cuenta Gmail">
        {gmail ? (
          <GmailSummary account={gmail} />
        ) : (
          <p className="description">
            Todavía no has conectado una cuenta Gmail. Acepta el consentimiento
            para continuar con Google.
          </p>
        )}
        {record &&
          !dirty &&
          (needsOAuth || record.error_code === 'REAUTH_REQUIRED') && (
            <a className="button" href="/api/gmail/connect?onboarding=1">
              {gmail ? 'Volver a conectar Gmail' : 'Conectar Gmail'}
            </a>
          )}
        {gmail?.status === 'PAUSED' && (
          <p className="description">
            La cuenta está pausada.{' '}
            <Link href="/settings">Reactívala desde ajustes</Link> para iniciar
            el análisis.
          </p>
        )}
      </Panel>
      <Panel title="03 · Aprende tu forma de escribir">
        <p className="description">
          El análisis no comienza al conectar Gmail. Inícialo cuando hayas
          revisado la cuenta y el alcance. Este paso no activa la automatización
          ni crea borradores.
        </p>
        {dirty && record && (
          <p className="form-message">
            Guarda el nuevo alcance y acepta de nuevo el consentimiento antes de
            analizar.
          </p>
        )}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="onboarding-progress"
        >
          {record?.status === 'QUEUED' && (
            <p>
              Solicitud en cola. Puedes cerrar la página; el análisis continuará
              en segundo plano cuando el servicio esté disponible.
            </p>
          )}
          {record?.status === 'SAMPLING' && (
            <p>
              Preparando la muestra: {record.scanned} mensajes examinados, hasta
              un máximo de {record.scope.maxCandidates}.
            </p>
          )}
          {record?.status === 'ANALYZING' && (
            <p>
              Creando tu perfil con {record.selected} ejemplos de escritura
              seleccionados.
            </p>
          )}
          {record?.status === 'COMPLETED' && (
            <>
              <p>
                Tu perfil de escritura está preparado a partir de{' '}
                {record.selected} ejemplos.
              </p>
              {record.selected < 200 && (
                <p>
                  La muestra contiene menos de los 200 ejemplos recomendados. El
                  perfil puede representar solo parte de tu estilo.
                </p>
              )}
              <p>
                El perfil queda pendiente de revisión antes de utilizarse en la
                automatización.
              </p>
            </>
          )}
          {record && ['FAILED', 'CANCELLED'].includes(record.status) && (
            <p>
              {onboardingMessages[record.error_code ?? ''] ??
                onboardingMessages.UNAVAILABLE}
            </p>
          )}
        </div>
        {message && messageStage === 'analysis' && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        {record && !active && record.status !== 'COMPLETED' && (
          <button
            type="button"
            className="button"
            disabled={busy || dirty || !connected}
            onClick={() =>
              void send({ action: 'start', revision: record.consent_revision })
            }
          >
            {busy
              ? 'Solicitando…'
              : record.status === 'CONSENTED'
                ? 'Iniciar análisis del historial'
                : 'Reintentar análisis'}
          </button>
        )}
        {record && active && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() =>
              void send({ action: 'cancel', revision: record.consent_revision })
            }
          >
            Cancelar análisis
          </button>
        )}
        {record?.status === 'COMPLETED' && (
          <div className="workspace-actions">
            <Link href="/style" className="button">
              Consultar mi perfil
            </Link>
            <Link href="/dashboard" className="button button-secondary">
              Ir al resumen
            </Link>
          </div>
        )}
      </Panel>
      <Panel title="Continúa preparando tu asistente">
        <p className="description">
          Aporta los documentos que puede consultar y revisa la configuración
          antes de activar la preparación de borradores.
        </p>
        <div className="workspace-actions">
          <Link href="/knowledge" className="button button-secondary">
            Añadir conocimiento
          </Link>
          <Link href="/settings" className="button button-secondary">
            Revisar ajustes
          </Link>
        </div>
      </Panel>
    </>
  );
}
