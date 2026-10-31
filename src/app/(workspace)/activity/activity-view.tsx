import Link from 'next/link';
import {
  activityReason,
  gmailConversationUrl,
  jobLabels,
  runLabels,
  triggerLabels,
  type ActivityFeed,
  type ActivityJob,
  type ActivityQuery,
  type ActivityDetail,
} from '@/modules/workflow/activity';
import { intentLabels } from '@/modules/workflow/automation-form';
import { DateTime, EmptyState, Panel, StatusBadge } from '../components';
import { ActivityRefresh } from './refresh-button';

export const activityHref = (query: ActivityQuery) =>
  `/activity?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))}`;
function tone(status: string) {
  return status === 'DRAFT_CREATED' || status === 'COMPLETED'
    ? 'success'
    : status === 'FAILED'
      ? 'danger'
      : status === 'REVIEW_REQUIRED'
        ? 'warning'
        : 'neutral';
}
export function ConversationLink({
  email,
  job,
}: {
  email: string | null;
  job: ActivityJob;
}) {
  const href = gmailConversationUrl(email, job.threadId);
  return href ? (
    <a
      className="text-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
    >
      Abrir conversación en Gmail ↗
    </a>
  ) : null;
}
function explanation(job: ActivityJob) {
  if (job.reason) return activityReason(job.reason);
  if (job.status === 'PENDING') return 'El mensaje está pendiente de análisis.';
  if (job.status === 'CLASSIFYING')
    return 'Se está comprobando si el mensaje necesita respuesta.';
  if (job.status === 'GENERATING')
    return 'Se está preparando y comprobando una propuesta.';
  if (job.status === 'DRAFT_CREATED')
    return 'Se ha registrado la creación de un borrador. Revísalo en Gmail antes de enviarlo.';
  return activityReason(job.classificationReasons[0] ?? null);
}
export function ActivityView({
  feed,
  query,
}: {
  feed: ActivityFeed;
  query: ActivityQuery;
}) {
  const { overview, counts } = feed;
  const active =
    overview.automationEnabled && overview.accountStatus === 'CONNECTED';
  const manual = overview.manualActive;
  return (
    <>
      <Panel title="Estado del asistente">
        <div className="panel-heading">
          <StatusBadge tone={active ? 'success' : 'neutral'}>
            {!overview.automationEnabled
              ? 'Automatización en pausa'
              : active
                ? 'Automatización activada'
                : overview.accountStatus === 'PAUSED'
                  ? 'Cuenta Gmail en pausa'
                  : overview.accountStatus === 'REAUTH_REQUIRED'
                    ? 'Gmail requiere autorización'
                    : 'Gmail pendiente de conexión'}
          </StatusBadge>
          <ActivityRefresh />
        </div>
        {manual && (
          <p className="form-message">
            Hay una revisión manual pendiente o en curso.
          </p>
        )}
        <dl className="settings-list">
          <div>
            <dt>Última sincronización con Gmail</dt>
            <dd>
              <DateTime
                value={overview.lastSyncAt}
                empty="Aún no se ha sincronizado"
              />
            </dd>
          </div>
          <div>
            <dt>Comprobación programada</dt>
            <dd>Cada {overview.pollSeconds} segundos</dd>
          </div>
          <div>
            <dt>Límite diario (UTC)</dt>
            <dd>{overview.dailyLimit} borradores</dd>
          </div>
        </dl>
        <Link className="text-link" href="/settings">
          Gestionar automatización y conexión →
        </Link>
      </Panel>
      <Panel title="Resultados de los mensajes">
        <p className="description">
          Totales de los registros conservados. Las revisiones detectan los
          correos; el análisis y la preparación de borradores pueden terminar
          después.
        </p>
        <dl className="run-metrics activity-totals">
          {(
            ['DRAFT_CREATED', 'SKIPPED', 'REVIEW_REQUIRED', 'FAILED'] as const
          ).map((status) => (
            <div key={status}>
              <dt>{jobLabels[status]}</dt>
              <dd>{counts[status]}</dd>
            </div>
          ))}
        </dl>
        <p className="description">
          {counts.PENDING} pendientes · {counts.CLASSIFYING} en análisis ·{' '}
          {counts.GENERATING} preparando respuesta.
        </p>
      </Panel>
      <Panel title="Mensajes y borradores">
        <form
          action="/activity"
          method="get"
          className="activity-filter"
          key={query.status}
        >
          <label>
            Filtrar mensajes por estado
            <select name="status" defaultValue={query.status}>
              <option value="ALL">Todos los estados</option>
              {Object.entries(jobLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-secondary" type="submit">
            Filtrar mensajes
          </button>
        </form>
        <p className="description">
          Se muestran hasta 20 mensajes por página, por fecha de detección. El
          panel conserva estados y referencias, sin copiar asuntos, remitentes
          ni cuerpos de correo.
        </p>
        {!feed.jobs.length ? (
          <EmptyState title="No hay mensajes para mostrar">
            {query.status === 'ALL'
              ? 'Los mensajes aparecerán cuando el asistente empiece a procesarlos.'
              : 'No hay registros que coincidan con este estado.'}
          </EmptyState>
        ) : (
          <ul className="activity-messages">
            {feed.jobs.map((job) => (
              <li key={job.id}>
                <div className="panel-heading">
                  <h3>Mensaje {job.id.slice(0, 8)}</h3>
                  <StatusBadge tone={tone(job.status)}>
                    {jobLabels[job.status]}
                  </StatusBadge>
                </div>
                <p className="description">
                  <DateTime value={job.createdAt} />
                  {job.category &&
                    ` · ${intentLabels[job.category as keyof typeof intentLabels] ?? 'Tipo no disponible'}`}
                </p>
                <p>{explanation(job)}</p>
                {job.draft?.status === 'CREATED' &&
                  job.status !== 'DRAFT_CREATED' && (
                    <p className="form-message">
                      Hay un borrador registrado para este mensaje. Consulta el
                      detalle antes de reintentar.
                    </p>
                  )}
                {job.draft?.reconciliation === 'MISSING' && (
                  <p className="form-message">
                    El borrador no se encontró en la última comprobación. Puede
                    haberse enviado o eliminado; compruébalo en Gmail.
                  </p>
                )}
                <div className="workspace-actions">
                  <Link
                    className="button button-secondary"
                    href={`/activity/${job.id}?status=${query.status}`}
                    aria-label={`Ver detalle del mensaje ${job.id.slice(0, 8)}`}
                  >
                    Ver detalle
                  </Link>
                  <ConversationLink email={overview.accountEmail} job={job} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="workspace-actions">
          {feed.nextCursor && (
            <Link
              className="button button-secondary"
              href={activityHref({ status: query.status, ...feed.nextCursor })}
            >
              Ver mensajes anteriores →
            </Link>
          )}
          {query.before && (
            <Link
              className="text-link"
              href={activityHref({ status: query.status })}
            >
              Volver a los mensajes recientes
            </Link>
          )}
        </div>
      </Panel>
      <Panel title="Últimas ejecuciones">
        <p className="description">
          Últimas 20 revisiones de correo. Sus contadores describen cada
          ejecución y no equivalen a los totales de mensajes procesados después.
        </p>
        {!feed.runs.length ? (
          <EmptyState title="Aún no hay ejecuciones">
            Las revisiones aparecerán aquí cuando se ejecute el asistente.
          </EmptyState>
        ) : (
          <ul className="activity-runs">
            {feed.runs.map((run) => (
              <li key={run.id}>
                <details>
                  <summary>
                    <span>
                      {triggerLabels[run.trigger]} ·{' '}
                      <DateTime value={run.startedAt} />
                    </span>
                    <StatusBadge tone={tone(run.status)}>
                      {runLabels[run.status]}
                    </StatusBadge>
                  </summary>
                  <dl className="run-metrics">
                    <div>
                      <dt>Detectados</dt>
                      <dd>{run.detected}</dd>
                    </div>
                    <div>
                      <dt>Procesados en esta ejecución</dt>
                      <dd>{run.processed}</dd>
                    </div>
                    <div>
                      <dt>Borradores registrados</dt>
                      <dd>{run.drafts}</dd>
                    </div>
                    <div>
                      <dt>Errores</dt>
                      <dd>{run.errors}</dd>
                    </div>
                  </dl>
                  <p className="description">
                    Finalización:{' '}
                    <DateTime value={run.finishedAt} empty="En curso" />.
                  </p>
                  {run.error && (
                    <p className="form-error">{activityReason(run.error)}</p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
const reconciliationLabels: Record<string, string> = {
  FOUND: 'Borrador localizado en Gmail.',
  EDITED: 'El borrador se ha editado en Gmail; se conserva su identidad.',
  MISSING:
    'El borrador no se encontró. Puede haberse enviado o eliminado; compruébalo en Gmail.',
  AMBIGUOUS: 'Hay resultados ambiguos; compruébalo en Gmail.',
  UNAVAILABLE: 'No se pudo comprobar el estado en Gmail.',
  NOT_STARTED: 'La escritura no llegó a iniciarse.',
  UNCONFIRMED: 'La creación no está confirmada.',
};
const draftLabels = {
  CREATING: 'Creación en curso',
  CREATED: 'Creación confirmada',
  UNCERTAIN: 'Creación sin confirmar',
  CANCELLED: 'Creación cancelada',
} as const;
export function ActivityDetailView({
  detail,
  email,
}: {
  detail: ActivityDetail;
  email: string | null;
}) {
  const { job } = detail;
  const draft = job.draft;
  return (
    <>
      <Panel title={`Mensaje ${job.id.slice(0, 8)}`}>
        <StatusBadge tone={tone(job.status)}>
          {jobLabels[job.status]}
        </StatusBadge>
        <p>{explanation(job)}</p>
        <dl className="settings-list">
          <div>
            <dt>Detectado</dt>
            <dd>
              <DateTime value={job.createdAt} />
            </dd>
          </div>
          <div>
            <dt>Inicio del procesamiento</dt>
            <dd>
              <DateTime value={job.startedAt} empty="Pendiente" />
            </dd>
          </div>
          <div>
            <dt>Finalización</dt>
            <dd>
              <DateTime value={job.finishedAt} empty="Pendiente" />
            </dd>
          </div>
          <div>
            <dt>Intentos registrados</dt>
            <dd>{job.attempts}</dd>
          </div>
        </dl>
        <ConversationLink email={email} job={job} />
        <p className="description">
          La conversación se abre en la cuenta Gmail vinculada. El panel no
          consulta ni copia su contenido.
        </p>
      </Panel>
      <Panel title="Motivos y advertencias">
        <ul className="activity-reasons">
          {[
            ...new Set([
              ...job.classificationReasons,
              ...job.risks,
              ...(draft?.warnings ?? []),
            ]),
          ].map((reason) => (
            <li key={reason}>{activityReason(reason)}</li>
          ))}
        </ul>
        {!job.classificationReasons.length &&
          !job.risks.length &&
          !draft?.warnings.length && (
            <p className="description">
              No hay advertencias adicionales registradas.
            </p>
          )}
      </Panel>
      <Panel title="Borrador en Gmail">
        {draft ? (
          <>
            <StatusBadge
              tone={
                draft.status === 'CREATED'
                  ? 'success'
                  : draft.status === 'UNCERTAIN'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {draftLabels[draft.status]}
            </StatusBadge>
            <p className="description">
              Registro actualizado: <DateTime value={draft.updatedAt} />.{' '}
              {draft.verifiedAt
                ? 'Última verificación: '
                : 'No hay una verificación confirmada registrada.'}
              {draft.verifiedAt && <DateTime value={draft.verifiedAt} />}
            </p>
            {draft.reconciliation && (
              <p className="form-message">
                {reconciliationLabels[draft.reconciliation] ??
                  'Consulta el estado actual del borrador en Gmail.'}
              </p>
            )}
            <p>Los borradores se revisan y envían manualmente desde Gmail.</p>
            <ConversationLink email={email} job={job} />
          </>
        ) : job.draftId ? (
          <>
            <p>
              Se registró un borrador creado; no se conservan más detalles de su
              creación.
            </p>
            <ConversationLink email={email} job={job} />
          </>
        ) : (
          <p className="description">
            No hay una creación de borrador registrada para este mensaje.
          </p>
        )}
      </Panel>
      <Panel title="Fuentes empleadas">
        <p className="description">
          Referencias conservadas al preparar el borrador. La disponibilidad
          actual de un documento puede haber cambiado.
        </p>
        {!detail.sources.length ? (
          <p className="description">
            No hay referencias de fuentes conservadas para este resultado.
          </p>
        ) : (
          <ul className="activity-sources">
            {detail.sources.map((source, index) => (
              <li key={index}>
                {source.kind === 'THREAD_MESSAGE' ? (
                  <strong>Mensaje de la conversación</strong>
                ) : source.kind === 'HISTORICAL_MESSAGE' ? (
                  <>
                    <strong>Contexto histórico autorizado</strong>
                    <p className="description">
                      Se conserva el tipo de referencia, sin mostrar mensajes ni
                      identidades de otras conversaciones.
                    </p>
                  </>
                ) : (
                  <>
                    <strong>
                      {source.sourceTitle ?? 'Fuente eliminada o no disponible'}
                    </strong>
                    <p>
                      {source.documentName ??
                        'Documento eliminado o no disponible'}{' '}
                      · Versión utilizada {source.version}
                    </p>
                    {source.currentVersion &&
                      source.currentVersion !== source.version && (
                        <p className="description">
                          Versión actual del documento: {source.currentVersion}.
                        </p>
                      )}
                    <StatusBadge
                      tone={source.available ? 'success' : 'warning'}
                    >
                      {source.available
                        ? 'Referencia disponible'
                        : 'Referencia no disponible actualmente'}
                    </StatusBadge>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <Link className="text-link" href="/knowledge">
          Gestionar documentos y fuentes →
        </Link>
      </Panel>
      <Panel title="Comprobaciones de respuesta">
        {!detail.policies.length && !detail.validations.length && (
          <p className="description">
            No hay comprobaciones de respuesta conservadas. El mensaje puede
            haberse omitido antes de generar una propuesta.
          </p>
        )}
        {detail.policiesTruncated && (
          <p className="description">
            Se muestran las últimas 50 comprobaciones de restricciones.
          </p>
        )}
        <ul className="activity-checks">
          {detail.policies.map((check, index) => (
            <li key={`policy-${index}`}>
              <strong>
                {check.phase === 'PREFLIGHT'
                  ? 'Comprobación previa'
                  : 'Comprobación final'}
                :{' '}
                {check.action === 'ALLOW_DRAFT'
                  ? 'superada'
                  : check.action === 'BLOCK'
                    ? 'respuesta bloqueada'
                    : 'requiere revisión'}
              </strong>
              <p className="description">
                <DateTime value={check.at} />
              </p>
              <ul>
                {check.reasons.map((reason) => (
                  <li key={reason}>{activityReason(reason)}</li>
                ))}
              </ul>
            </li>
          ))}
          {detail.validationsTruncated && (
            <li>Se muestran las últimas 20 comprobaciones de hechos.</li>
          )}
          {detail.validations.map((check, index) => (
            <li key={`validation-${index}`}>
              <strong>
                Comprobación de hechos:{' '}
                {check.status === 'SUPPORTED'
                  ? 'superada'
                  : 'requiere revisión'}
              </strong>
              <p className="description">
                <DateTime value={check.at} /> · {check.claims} afirmaciones
                comprobadas.
              </p>
              <ul>
                {check.issues.map((issue, index) => (
                  <li key={index}>{activityReason(issue.reason)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Recorrido del mensaje">
        {detail.eventsTruncated && (
          <p className="description">
            Se muestran los últimos 100 cambios de estado.
          </p>
        )}
        <ol className="activity-timeline">
          {detail.events.map((event, index) => (
            <li key={index}>
              <strong>
                {event.from ? `${jobLabels[event.from]} → ` : ''}
                {jobLabels[event.to]}
              </strong>
              <p className="description">
                <DateTime value={event.at} />
              </p>
              {event.reason && <p>{activityReason(event.reason)}</p>}
            </li>
          ))}
        </ol>
        <p className="description">Referencia de soporte: {job.id}.</p>
      </Panel>
    </>
  );
}
