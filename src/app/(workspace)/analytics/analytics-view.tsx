'use client';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  analyticsRates,
  estimateSavedMinutes,
  rateDelta,
  timeAssumptionsSchema,
  type AnalyticsSnapshot,
} from '@/modules/analytics/dashboard';
import { activityReason } from '@/modules/workflow/activity';
import { DateTime, Panel } from '../components';

const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const percent = (value: number | null) =>
  value === null ? 'Sin datos' : `${number.format(value * 100)} %`;
const usd = (value: number | null) =>
  value === null
    ? 'Sin tarifa registrada'
    : new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }).format(value);
function Delta({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  const delta = rateDelta(current, previous);
  return (
    <span className="field-help">
      {delta === null
        ? 'Sin base comparable'
        : `${delta > 0 ? '+' : ''}${number.format(delta)} puntos porcentuales frente al periodo anterior`}
    </span>
  );
}
function Reasons({
  items,
  other,
}: {
  items: AnalyticsSnapshot['omissionReasons'];
  other: number;
}) {
  return items.length ? (
    <dl className="settings-list">
      {items.map((item) => (
        <div key={item.code}>
          <dt>{activityReason(item.code)}</dt>
          <dd>{number.format(item.count)}</dd>
        </div>
      ))}
      {other > 0 && (
        <div>
          <dt>Otros motivos</dt>
          <dd>{number.format(other)}</dd>
        </div>
      )}
    </dl>
  ) : (
    <p className="description">No hay casos registrados en este periodo.</p>
  );
}
export function TimeEstimate({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const [manual, setManual] = useState(''),
    [review, setReview] = useState(''),
    [edit, setEdit] = useState('');
  const parsed =
    manual !== '' && review !== '' && edit !== ''
      ? timeAssumptionsSchema.safeParse({
          manualMinutes: Number(manual),
          reviewMinutes: Number(review),
          secondsPerEdit: Number(edit),
        })
      : null;
  const assumptions = parsed?.success ? parsed.data : null;
  const minutes = estimateSavedMinutes(snapshot.current.totals, assumptions);
  return (
    <Panel title="Simulación de tiempo">
      <p className="description">
        Introduce tiempos medidos en una muestra de tu trabajo. Son hipótesis
        tuyas, no una medición automática. Se aplican solo a los{' '}
        {snapshot.current.totals.compared} envíos comparados; no se extrapolan a
        los demás.
      </p>
      <div className="analytics-inputs">
        <label>
          Redactar a mano (min)
          <input
            type="number"
            min="0.1"
            max="120"
            step="any"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </label>
        <label>
          Revisar borrador (min)
          <input
            type="number"
            min="0"
            max="120"
            step="any"
            value={review}
            onChange={(e) => setReview(e.target.value)}
          />
        </label>
        <label>
          Corregir palabra o signo (s)
          <input
            type="number"
            min="0"
            max="60"
            step="any"
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
          />
        </label>
      </div>
      {parsed && !parsed.success && (
        <p className="form-error" role="alert">
          Usa entre 0,1 y 120 minutos para redactar, entre 0 y 120 para revisar
          y entre 0 y 60 segundos por corrección.
        </p>
      )}
      <p role="status">
        {minutes === null
          ? 'Sin estimación: completa los tiempos y necesita haber envíos comparados.'
          : `Ahorro simulado: ${number.format(minutes)} minutos`}
      </p>
      <p className="field-help">
        Fórmula v1: envíos comparados × (minutos de redacción − minutos de
        revisión) − distancia de edición × segundos por corrección / 60. La
        distancia cuenta inserciones, eliminaciones y sustituciones de palabras
        o signos normalizados. Puede dar un resultado negativo. No incluye
        esperas del sistema. Los tiempos se mantienen solo mientras esta página
        está abierta.
      </p>
    </Panel>
  );
}
export function AnalyticsView({
  snapshot: s,
}: {
  snapshot: AnalyticsSnapshot;
}) {
  const [pending, start] = useTransition(),
    router = useRouter();
  const t = s.current.totals,
    prior = s.previous.totals,
    r = analyticsRates(t),
    p = analyticsRates(prior);
  const max = Math.max(
    1,
    ...s.daily.map((d) => Math.max(d.draftsCreated, d.sendsConfirmed)),
  );
  const points = (field: 'draftsCreated' | 'sendsConfirmed') =>
    s.daily
      .map(
        (d, i) =>
          `${40 + (i * 640) / Math.max(1, s.daily.length - 1)},${150 - (d[field] * 130) / max}`,
      )
      .join(' ');
  return (
    <>
      <Panel title="Periodo de observación">
        <div className="workspace-actions">
          {(['7', '30', '90'] as const).map((days) => (
            <Link
              key={days}
              href={`/analytics?days=${days}`}
              className="button button-secondary"
              aria-current={s.days === Number(days) ? 'page' : undefined}
            >
              Últimos {days} días
            </Link>
          ))}
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            aria-busy={pending}
            onClick={() => start(() => router.refresh())}
          >
            {pending ? 'Actualizando…' : 'Actualizar métricas'}
          </button>
        </div>
        <p className="description">
          Actual: <DateTime value={s.current.from} /> →{' '}
          <DateTime value={s.current.to} />. Anterior, con la misma duración:{' '}
          <DateTime value={s.previous.from} /> →{' '}
          <DateTime value={s.previous.to} />. Zona horaria: Europe/Madrid. El
          último día es parcial.
        </p>
        <p className="field-help">
          Resultados actuales de los borradores creados en cada periodo. Pueden
          actualizarse cuando se envíen después. Los trabajos y las generaciones
          se agrupan por su propia fecha de creación. Las métricas comienzan con
          los registros disponibles; un periodo sin registros no prueba que no
          hubiera actividad.
        </p>
      </Panel>
      <div className="workspace-grid">
        <Panel title="Uso observado">
          <dl className="settings-list">
            <div>
              <dt>Borradores creados</dt>
              <dd>{number.format(t.draftsCreated)}</dd>
            </div>
            <div>
              <dt>Envíos confirmados de esos borradores</dt>
              <dd>{number.format(t.sendsConfirmed)}</dd>
            </div>
            <div>
              <dt>Uso confirmado (aceptación mínima)</dt>
              <dd>
                {percent(r.usage)}
                <Delta current={r.usage} previous={p.usage} />
              </dd>
            </div>
            <div>
              <dt>Pendientes de envío o comprobación</dt>
              <dd>{number.format(t.pending)}</dd>
            </div>
            <div>
              <dt>Resultado indeterminado</dt>
              <dd>{number.format(t.indeterminate)}</dd>
            </div>
            <div>
              <dt>Respuestas independientes observadas</dt>
              <dd>{number.format(t.independentReplies)}</dd>
            </div>
            <div>
              <dt>Descartados antes de crear</dt>
              <dd>{number.format(t.discardedBeforeWrite)}</dd>
            </div>
          </dl>
          <p className="field-help">
            Envíos confirmados / borradores creados. Un borrador desaparecido o
            pendiente no se cuenta como rechazo. Los descartes son cancelaciones
            antes de escribir en Gmail; no permiten inferir borrados manuales.
          </p>
        </Panel>
        <Panel title="Calidad observada">
          <dl className="settings-list">
            <div>
              <dt>Envíos comparados</dt>
              <dd>
                {number.format(t.compared)} de {number.format(t.sendsConfirmed)}{' '}
                ({percent(r.comparisonCoverage)})
              </dd>
            </div>
            <div>
              <dt>Enviados con cambios</dt>
              <dd>
                {number.format(t.edited)} · {percent(r.edited)}
                <Delta current={r.edited} previous={p.edited} />
              </dd>
            </div>
            <div>
              <dt>Sin cambios tras normalización</dt>
              <dd>
                {number.format(t.unchanged)} · {percent(r.unchanged)}
              </dd>
            </div>
            <div>
              <dt>Similitud media normalizada</dt>
              <dd>{percent(t.meanSimilarity)}</dd>
            </div>
            <div>
              <dt>Cambios con señales factuales</dt>
              <dd>{number.format(t.factualReview)}</dd>
            </div>
            <div>
              <dt>Otros cambios de contenido</dt>
              <dd>{number.format(t.contentReview)}</dd>
            </div>
            <div>
              <dt>Comparaciones omitidas / pendientes</dt>
              <dd>
                {number.format(t.comparisonSkipped)} /{' '}
                {number.format(t.comparisonPending)}
              </dd>
            </div>
          </dl>
          <p className="field-help">
            La tasa de edición usa solo los envíos comparados. Requiere
            autorización previa para conservar temporalmente el original. La
            similitud no mide corrección factual; incluye normalización de
            espacios y citas. Los cambios detectados son señales para revisión
            humana. Compara tendencias teniendo en cuenta el tamaño y la
            cobertura de ambas muestras: antes {prior.compared} de{' '}
            {prior.sendsConfirmed} envíos, ahora {t.compared} de{' '}
            {t.sendsConfirmed}.
          </p>
        </Panel>
        <Panel title="Consumo y coste estimado">
          <dl className="settings-list">
            <div>
              <dt>Intentos de generación / fallidos</dt>
              <dd>
                {t.generationAttempts} / {t.generationFailures}
              </dd>
            </div>
            <div>
              <dt>Tokens de entrada / salida registrados</dt>
              <dd>
                {number.format(t.inputTokens)} / {number.format(t.outputTokens)}
              </dd>
            </div>
            <div>
              <dt>Llamadas al modelo registradas</dt>
              <dd>{number.format(t.modelCalls)}</dd>
            </div>
            <div>
              <dt>Generaciones con consumo conocido</dt>
              <dd>
                {t.usageKnownGenerations} de {t.generationAttempts} (
                {percent(r.usageCoverage)})
              </dd>
            </div>
            <div>
              <dt>Subtotal estimado con tarifa</dt>
              <dd>{usd(t.knownCostUsd)}</dd>
            </div>
            <div>
              <dt>Coste medio por generación con tarifa</dt>
              <dd>
                {usd(t.meanKnownCostUsd)}
                <span className="field-help">
                  Periodo anterior: {usd(prior.meanKnownCostUsd)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Cobertura de coste</dt>
              <dd>
                {t.pricedGenerations} de {t.generationAttempts} (
                {percent(r.costCoverage)}); {t.unpricedGenerations} sin
                estimación
              </dd>
            </div>
            <div>
              <dt>Duración media de generación</dt>
              <dd>
                {t.meanDurationMs === null
                  ? 'Sin datos'
                  : `${number.format(t.meanDurationMs / 1000)} s`}
              </dd>
            </div>
            <div>
              <dt>Tokens de clasificación registrados, entrada / salida</dt>
              <dd>
                {number.format(t.classificationInputTokens)} /{' '}
                {number.format(t.classificationOutputTokens)}
              </dd>
            </div>
          </dl>
          <p className="field-help">
            Costes estimados en USD según la tarifa guardada en cada generación
            de respuesta, incluida su validación. El promedio usa solo
            generaciones con tarifa. Los datos sin tarifa o consumo no equivalen
            a coste cero. No representa la factura total de OpenAI: no incluye
            análisis de estilo, recuperación ni clasificación. Los tokens de
            clasificación se muestran aparte, sin coste atribuido.
          </p>
        </Panel>
        <Panel title="Omisiones e intervención humana">
          <p className="description">
            De {t.jobTotal} trabajos iniciados en el periodo: {t.skippedJobs}{' '}
            omitidos, {t.reviewJobs} requieren revisión y {t.failedJobs}{' '}
            fallidos. Se muestra el estado actual y el motivo registrado.
          </p>
          <h3>Motivos de omisión</h3>
          <Reasons items={s.omissionReasons} other={s.omissionOther} />
          <h3>Motivos de revisión humana</h3>
          <Reasons items={s.reviewReasons} other={s.reviewOther} />
          <Link className="text-link" href="/activity">
            Consultar los casos en actividad →
          </Link>
        </Panel>
      </div>
      <Panel title="Tendencia diaria">
        <p className="description">
          Borradores creados y envíos confirmados de esos mismos borradores,
          según el día de creación.
        </p>
        <svg
          className="analytics-chart"
          viewBox="0 0 720 185"
          role="img"
          aria-label="Tendencia de borradores y envíos; valores exactos en la tabla diaria"
        >
          <text x="8" y="24">
            {max}
          </text>
          <text x="8" y="154">
            0
          </text>
          <path d="M40 20V150H680" fill="none" stroke="currentColor" />
          <polyline
            points={points('draftsCreated')}
            fill="none"
            stroke="#275f55"
            strokeWidth="3"
          />
          <polyline
            points={points('sendsConfirmed')}
            fill="none"
            stroke="#924d24"
            strokeWidth="3"
            strokeDasharray="7 4"
          />
          <text x="40" y="177">
            {s.daily[0]?.day}
          </text>
          <text x="680" y="177" textAnchor="end">
            {s.daily.at(-1)?.day}
          </text>
        </svg>
        <p className="field-help">
          Línea continua verde: creados. Línea discontinua marrón: envíos
          confirmados.
        </p>
        <details>
          <summary>Ver datos diarios</summary>
          <div className="analytics-table">
            <table>
              <caption>
                Registros diarios · Europe/Madrid · coste parcial con tarifa
              </caption>
              <thead>
                <tr>
                  {[
                    'Día',
                    'Generaciones',
                    'Creados',
                    'Enviados',
                    'Comparados',
                    'Editados',
                    'Coste estimado',
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.daily.map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{d.day}</th>
                    <td>{d.generationAttempts}</td>
                    <td>{d.draftsCreated}</td>
                    <td>{d.sendsConfirmed}</td>
                    <td>{d.compared}</td>
                    <td>{d.edited}</td>
                    <td>{usd(d.knownCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Panel>
      <TimeEstimate snapshot={s} />
    </>
  );
}
