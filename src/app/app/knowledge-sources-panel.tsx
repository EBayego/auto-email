'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { DocumentMetadata } from '@/modules/knowledge/documents';
import type { KnowledgeRetrievalResult } from '@/modules/knowledge/retriever';
import type {
  SourceConfiguration,
  SourceOperation,
  SourceRule,
} from '@/modules/source-router/sources';

const intents = {
  '*': 'Cualquier intención',
  REQUEST_INFORMATION: 'Solicitud de información',
  REQUEST_ACTION: 'Solicitud de acción',
  CONFIRMATION: 'Confirmación',
  FOLLOW_UP: 'Seguimiento',
  MEETING: 'Reunión',
  COMPLAINT: 'Reclamación',
  FINANCIAL: 'Consulta financiera',
  LEGAL_CONTRACT: 'Asunto legal o contractual',
  NOTIFICATION: 'Notificación',
  UNKNOWN: 'Sin determinar',
};
const errors: Record<string, string> = {
  SOURCE_IN_USE:
    'La fuente tiene documentos o reglas asociados. Retira esas asociaciones antes de eliminarla.',
  SOURCE_LIMIT: 'Puedes configurar hasta 20 fuentes.',
  RULE_LIMIT: 'Puedes configurar hasta 50 reglas.',
  SOURCE_CONFIGURATION_CHANGED: 'Las reglas han cambiado. Vuelve a consultar.',
  INVALID_INPUT:
    'Revisa los campos. Cada fuente debe tener un nombre distinto y no puede estar a la vez como principal, respaldo o excluida en una misma regla.',
};
type RoutedResult = KnowledgeRetrievalResult;

export function KnowledgeSourcesPanel({
  documents,
  onUpdated,
}: {
  documents: DocumentMetadata[];
  onUpdated(): Promise<void>;
}) {
  const [configuration, setConfiguration] = useState<SourceConfiguration>({
    revision: '',
    allowPartialDrafts: false,
    sources: [],
    rules: [],
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<SourceRule | null>(null);
  const [result, setResult] = useState<RoutedResult | null>(null);
  const resultIsCurrent = result?.review.references.every((reference) =>
    documents.some(
      (document) =>
        document.id === reference.document_id &&
        document.source_id === reference.source_id &&
        document.version === reference.version &&
        document.status === 'READY' &&
        document.content_updated_at === reference.document_updated_at &&
        document.valid_from === reference.valid_from &&
        document.valid_until === reference.valid_until &&
        (!document.indexed_at ||
          Date.parse(document.indexed_at) <=
            Date.parse(result.review.evaluated_at)),
    ),
  );
  async function load() {
    const response = await fetch('/api/knowledge/sources', {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error();
    setConfiguration(await response.json());
  }
  useEffect(() => {
    let active = true;
    fetch('/api/knowledge/sources', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((value) => {
        if (active) setConfiguration(value);
      })
      .catch(() => {
        if (active) setMessage('No se pueden cargar las fuentes.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function mutate(operation: SourceOperation) {
    setBusy(true);
    setMessage('Guardando…');
    setResult(null);
    try {
      const response = await fetch('/api/knowledge/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(operation),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      await load();
      await onUpdated();
      setMessage('Configuración guardada.');
      return true;
    } catch (error) {
      setMessage(
        errors[(error as Error).message] ??
          'No se ha podido guardar la configuración.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveSource(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await mutate({
      action: 'save_source',
      id,
      title: String(data.get('title')),
      priority: Number(data.get('priority')),
      enabled: data.has('enabled'),
    });
    if (saved && !id) form.reset();
  }
  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await mutate({
        action: 'save_rule',
        id: editing?.id,
        title: String(data.get('title')),
        intent: String(data.get('intent')) as SourceRule['intent'],
        terms: String(data.get('terms') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        priority: Number(data.get('priority')),
        enabled: data.has('enabled'),
        allowEmailHistory: data.has('allowEmailHistory'),
        primarySourceIds: data.getAll('primary').map(String),
        fallbackSourceIds: data.getAll('fallback').map(String),
        excludedSourceIds: data.getAll('excluded').map(String),
      })
    ) {
      setEditing(null);
      form.reset();
    }
  }
  async function consult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setResult(null);
    setMessage('Consultando fuentes autorizadas…');
    try {
      const response = await fetch(
        `/api/knowledge/search?${new URLSearchParams({ q: String(data.get('query')), intent: String(data.get('intent')) })}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      setResult(await response.json());
      setMessage('');
    } catch (error) {
      setMessage(
        errors[(error as Error).message] ??
          'No se ha podido realizar la consulta.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="knowledge-sources" aria-labelledby="sources-title">
      <h3 id="sources-title">Fuentes y reglas de consulta</h3>
      <p className="description">
        Agrupa tus documentos por fuente. Los documentos sin fuente no se
        consultan por reglas. Un número de prioridad menor se consulta primero.
        Las exclusiones prevalecen cuando coinciden varias reglas.
      </p>
      {message && (
        <p role="status" aria-live="polite" className="description">
          {message}
        </p>
      )}
      <form
        className="execution-form"
        key={`partial-${configuration.allowPartialDrafts}`}
        onSubmit={(event) => {
          event.preventDefault();
          void mutate({
            action: 'set_sufficiency_preferences',
            allowPartialDrafts: new FormData(event.currentTarget).has(
              'allowPartialDrafts',
            ),
          });
        }}
      >
        <label>
          <input
            type="checkbox"
            name="allowPartialDrafts"
            defaultChecked={configuration.allowPartialDrafts}
            disabled={busy}
          />{' '}
          Permitir propuestas parciales para revisión
        </label>
        <p className="description">
          Una propuesta parcial contiene solo información respaldada y una nota
          interna con lo pendiente. Requiere intervención del titular y se
          mantiene fuera de la creación automática de borradores en Gmail.
        </p>
        <button className="button button-secondary" disabled={busy}>
          Guardar preferencia
        </button>
      </form>
      <details>
        <summary>Gestionar fuentes</summary>
        <form
          onSubmit={(event) => void saveSource(event)}
          className="execution-form"
        >
          <label>
            Nombre de la nueva fuente
            <input
              name="title"
              maxLength={100}
              placeholder="Tarifas vigentes"
              required
            />
          </label>
          <label>
            Prioridad
            <input
              name="priority"
              type="number"
              min={0}
              max={1000}
              defaultValue={100}
              required
            />
          </label>
          <label>
            <input name="enabled" type="checkbox" defaultChecked /> Fuente
            activada
          </label>
          <button className="button button-secondary" disabled={busy}>
            Crear fuente
          </button>
        </form>
        {configuration.sources.map((source) => (
          <form
            key={`${source.id}-${source.title}-${source.priority}-${source.enabled}`}
            onSubmit={(event) => void saveSource(event, source.id)}
            className="execution-form"
          >
            <label>
              Nombre de la fuente
              <input
                name="title"
                defaultValue={source.title}
                maxLength={100}
                required
              />
            </label>
            <label>
              Prioridad
              <input
                name="priority"
                type="number"
                min={0}
                max={1000}
                defaultValue={source.priority}
                required
              />
            </label>
            <label>
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={source.enabled}
              />{' '}
              Fuente activada
            </label>
            <div>
              <button className="button button-secondary" disabled={busy}>
                Guardar fuente
              </button>{' '}
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() =>
                  void mutate({ action: 'delete_source', id: source.id })
                }
              >
                Eliminar fuente
              </button>
            </div>
          </form>
        ))}
      </details>
      <details>
        <summary>Asignar documentos a fuentes</summary>
        {documents
          .filter((d) => d.status !== 'DELETING')
          .map((document) => (
            <label key={document.id} className="source-assignment">
              {document.name}
              <select
                value={document.source_id ?? ''}
                disabled={busy}
                onChange={(event) =>
                  void mutate({
                    action: 'assign_document',
                    documentId: document.id,
                    sourceId: event.target.value || null,
                  })
                }
              >
                <option value="">Sin fuente asignada</option>
                {configuration.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                    {!source.enabled ? ' (desactivada)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {!documents.length && (
          <p className="description">
            Sube un documento para asignarlo a una fuente.
          </p>
        )}
      </details>
      <details>
        <summary>Gestionar reglas</summary>
        <ul className="documents-list">
          {configuration.rules.map((rule) => (
            <li key={rule.id}>
              <strong>{rule.title}</strong> ·{' '}
              {rule.enabled ? 'Activa' : 'Desactivada'} · Prioridad{' '}
              {rule.priority}
              <p className="description">
                {intents[rule.intent]}
                {rule.terms.length ? ` · ${rule.terms.join(', ')}` : ''} ·
                Historial de emails{' '}
                {rule.allowEmailHistory ? 'permitido' : 'prohibido'}
              </p>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setEditing(rule)}
              >
                Editar regla
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() =>
                  void mutate({ action: 'delete_rule', id: rule.id }).then(
                    (saved) => {
                      if (saved && editing?.id === rule.id) setEditing(null);
                    },
                  )
                }
              >
                Eliminar regla
              </button>
            </li>
          ))}
        </ul>
        <form
          key={editing?.id ?? 'new'}
          onSubmit={(event) => void saveRule(event)}
          className="execution-form"
        >
          <h4>{editing ? 'Editar regla' : 'Nueva regla'}</h4>
          <label>
            Nombre
            <input
              name="title"
              defaultValue={editing?.title ?? ''}
              maxLength={100}
              required
            />
          </label>
          <label>
            Intención
            <select name="intent" defaultValue={editing?.intent ?? '*'}>
              {Object.entries(intents).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Palabras o frases, separadas por comas
            <input
              name="terms"
              defaultValue={editing?.terms.join(', ') ?? ''}
              placeholder="precio, precios, tarifa, tarifas"
            />
          </label>
          <p className="description">
            La regla se aplica si coincide la intención y alguna frase. Sin
            frases, se aplica a toda esa intención.
          </p>
          <label>
            Prioridad de la regla
            <input
              name="priority"
              type="number"
              min={0}
              max={1000}
              defaultValue={editing?.priority ?? 100}
              required
            />
          </label>
          {(['primary', 'fallback', 'excluded'] as const).map((role, index) => (
            <label key={role}>
              {
                [
                  'Fuentes principales',
                  'Fuentes de respaldo',
                  'Fuentes excluidas',
                ][index]
              }
              <select
                name={role}
                multiple
                size={Math.max(2, Math.min(5, configuration.sources.length))}
                required={role === 'primary'}
                defaultValue={
                  editing?.[
                    `${role === 'excluded' ? 'excluded' : role}SourceIds`
                  ] ?? []
                }
              >
                {configuration.sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title}
                    {!source.enabled ? ' (desactivada)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="description">
            Selecciona varias fuentes con Ctrl o Cmd. El respaldo se consulta si
            la búsqueda principal no aporta evidencia suficiente.
          </p>
          <label>
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={editing?.enabled ?? true}
            />{' '}
            Regla activada
          </label>
          <label>
            <input
              name="allowEmailHistory"
              type="checkbox"
              defaultChecked={editing?.allowEmailHistory ?? false}
            />{' '}
            Permitir emails antiguos como fuente de hechos
          </label>
          <button
            className="button button-secondary"
            disabled={busy || !configuration.sources.length}
          >
            Guardar regla
          </button>
          {editing && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setEditing(null)}
            >
              Cancelar edición
            </button>
          )}
        </form>
      </details>
      <form
        onSubmit={(event) => void consult(event)}
        className="execution-form"
      >
        <h4>Consultar según tus reglas</h4>
        <label>
          Pregunta
          <input name="query" maxLength={300} required />
        </label>
        <label>
          Intención
          <select name="intent" defaultValue="REQUEST_INFORMATION">
            {Object.entries(intents)
              .filter(([value]) => value !== '*')
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <button className="button button-secondary" disabled={busy}>
          Consultar fuentes autorizadas
        </button>
      </form>
      {result && !resultIsCurrent && (
        <p role="status" className="description">
          Los documentos han cambiado. Consulta de nuevo para revisar su
          vigencia y procedencia.
        </p>
      )}
      {result && resultIsCurrent && (
        <div>
          <p role="status" className="description">
            {result.plan.reason === 'NO_MATCHING_RULE'
              ? 'No hay ninguna regla aplicable.'
              : result.plan.reason === 'NO_AUTHORIZED_SOURCES'
                ? 'Las reglas no autorizan ninguna fuente activa.'
                : result.usedFallback
                  ? 'Se han consultado las fuentes de respaldo.'
                  : 'Se han consultado las fuentes principales.'}{' '}
            Historial de emails{' '}
            {result.plan.allowEmailHistory
              ? 'permitido por las reglas'
              : 'prohibido por las reglas'}
            .
          </p>
          <p className="description">
            Principales:{' '}
            {result.plan.primarySources.map((s) => s.title).join(', ') ||
              'ninguna'}
            . Respaldo:{' '}
            {result.plan.fallbackSources.map((s) => s.title).join(', ') ||
              'ninguno'}
            .
          </p>
          {result.sufficiency.status === 'NEEDS_HUMAN_INPUT' && (
            <div role="status" className="description">
              <p>Falta información para una respuesta completa:</p>
              <ul>
                {result.sufficiency.missingInformation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {result.allowPartialDrafts &&
                result.sufficiency.canPreparePartial && (
                  <p>
                    Se puede preparar una propuesta parcial con los datos
                    respaldados para revisión del titular.
                  </p>
                )}
            </div>
          )}
          {result.truncated && (
            <p className="description">
              Se muestran los fragmentos seleccionados dentro del límite de
              contexto.
            </p>
          )}
          {result.policy.action === 'REVIEW_REQUIRED' && (
            <p role="alert" className="form-error">
              {result.policy.reasons.includes('KNOWLEDGE_CONFLICT')
                ? 'Hay información contradictoria que requiere revisión. No se generará una respuesta con estos datos.'
                : 'Las fuentes encontradas están fuera de su vigencia. Se necesita información válida.'}
            </p>
          )}
          {result.review.conflicts.length > 0 && (
            <details>
              <summary>
                Conflictos entre documentos ({result.review.conflicts.length})
              </summary>
              <ul>
                {result.review.conflicts.map((conflict, index) => (
                  <li key={index}>
                    <strong>{conflict.fact}</strong>
                    <p>
                      {
                        result.review.references.find(
                          (r) => r.reference_id === conflict.left.reference_id,
                        )?.document_name
                      }
                      : {conflict.left.quote}
                    </p>
                    <p>
                      {
                        result.review.references.find(
                          (r) => r.reference_id === conflict.right.reference_id,
                        )?.document_name
                      }
                      : {conflict.right.quote}
                    </p>
                    <p className="description">
                      {conflict.resolution === 'UNRESOLVED'
                        ? 'Sin resolver: requiere revisión.'
                        : conflict.resolution === 'PREFER_CURRENT'
                          ? 'Se usa el documento con vigencia declarada.'
                          : 'Se aplica la autoridad de fuente configurada.'}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.review.omitted.length > 0 && (
            <details>
              <summary>
                Fragmentos descartados ({result.review.omitted.length})
              </summary>
              <ul>
                {result.review.omitted.map((omission) => {
                  const reference = result.review.references.find(
                    (r) => r.reference_id === omission.reference_id,
                  );
                  return (
                    <li key={omission.reference_id}>
                      {reference?.document_name} ·{' '}
                      {omission.reason === 'EXPIRED'
                        ? 'Vigencia terminada'
                        : omission.reason === 'NOT_YET_VALID'
                          ? 'Todavía no vigente'
                          : 'Valor contradictorio de menor precedencia'}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
          {result.plan.reason === 'MATCHED_RULES' && !result.matches.length && (
            <p className="description">
              No se encontraron coincidencias en las fuentes autorizadas.
            </p>
          )}
          <ul className="documents-list">
            {result.matches
              .filter((match) =>
                documents.some(
                  (d) =>
                    d.id === match.document_id &&
                    d.source_id === match.source_id &&
                    d.version === match.version,
                ),
              )
              .map((match) => (
                <li key={match.chunk_id}>
                  <strong>
                    {match.source_title} · {match.document_name}
                  </strong>
                  <p className="description">
                    Versión {match.version}
                    {match.section && ` · ${match.section}`}
                  </p>
                  <p className="description">
                    Contenido incorporado/actualizado:{' '}
                    {new Date(match.document_updated_at).toLocaleString(
                      'es-ES',
                      { timeZone: 'Europe/Madrid' },
                    )}
                    . Vigencia:{' '}
                    {match.valid_from || match.valid_until
                      ? `${match.valid_from ?? 'sin inicio declarado'} → ${match.valid_until ?? 'sin fin declarado'}`
                      : 'sin declarar'}
                    . Autoridad: {match.source_priority} (menor valor, mayor
                    prioridad).
                  </p>
                  <details>
                    <summary>Referencia interna</summary>
                    <code>
                      {
                        result.review.references.find(
                          (r) => r.chunk_id === match.chunk_id,
                        )?.reference_id
                      }
                    </code>
                  </details>
                  <p className="knowledge-excerpt">{match.content}</p>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
