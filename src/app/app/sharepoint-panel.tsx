'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  ConnectorSnapshot,
  SharePointConnector,
  SyncedItem,
} from '@/modules/sharepoint/contracts';
import { MicrosoftConnectionNotice } from './microsoft-connection-notice';

type Entry = { id: string; name?: string; webUrl?: string };
type Browse = {
  site: Entry;
  drives?: Entry[];
  folder?: Entry;
  folders?: Entry[];
  next?: string | null;
};
const errors: Record<string, string> = {
  CONNECTOR_DISABLED:
    'La conexión SharePoint todavía no está configurada en el servidor.',
  OVERLAPPING_ROOTS:
    'Esta carpeta coincide con otra fuente o contiene una carpeta ya conectada.',
  REAUTH_REQUIRED: 'Vuelve a conectar la cuenta de Microsoft.',
  ACCESS_DENIED:
    'Microsoft no permite leer este recurso con la cuenta conectada.',
  MICROSOFT_IDENTITY_REJECTED:
    'El tenant o la identidad Microsoft no están autorizados.',
  MICROSOFT_SCOPE_REQUIRED:
    'Falta conceder el permiso de lectura de SharePoint.',
  SITE_URL_REQUIRED:
    'Introduce la URL del sitio, por ejemplo https://empresa.sharepoint.com/sites/Comercial.',
  CONNECTOR_LIMIT:
    'Se ha alcanzado una cuota de archivos, tamaño o conexiones.',
  OCR_NOT_CONFIGURED: 'Este archivo necesita OCR, pendiente de configurar.',
  EMBEDDED_OCR_NOT_CONFIGURED:
    'El archivo contiene imágenes cuyo texto necesita OCR.',
  OCR_REVIEW_REQUIRED:
    'El OCR contiene datos dudosos. Requiere revisión del documento original.',
  OCR_DAILY_BUDGET:
    'Se ha alcanzado el presupuesto diario de OCR. Amplía la cuota o reintenta otro día.',
  AUDIENCE_CONFLICT:
    'La excepción del archivo debe ser igual o más restrictiva que la audiencia de la carpeta.',
  PRIVACY_CONSENT_REQUIRED:
    'Revisa y acepta la información de privacidad antes de conectar o consultar SharePoint.',
};
export function SharePointPanel({
  oauthResult,
}: { oauthResult?: string } = {}) {
  const [snapshot, setSnapshot] = useState<ConnectorSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [drive, setDrive] = useState('');
  const [path, setPath] = useState<Entry[]>([]);
  const [ack, setAck] = useState(false);
  const [files, setFiles] = useState<SyncedItem[]>([]);
  const [fileConnector, setFileConnector] = useState('');
  const [offset, setOffset] = useState(0);
  async function json(response: Response) {
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'UNAVAILABLE');
    return value;
  }
  const load = useCallback(async () => {
    const response = await fetch('/api/knowledge/connectors', {
      cache: 'no-store',
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'UNAVAILABLE');
    setSnapshot(value);
    setConnection((current) => current || value.connections[0]?.id || '');
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (active) return load();
      })
      .catch(() => {
        if (active) setMessage('No se han podido cargar las conexiones.');
      });
    const timer = setInterval(() => {
      if (active) void load().catch(() => {});
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);
  async function act(input: Record<string, unknown>) {
    return json(
      await fetch('/api/knowledge/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    );
  }
  async function execute(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setMessage(
        errors[code] ??
          'No se ha podido completar la operación. Vuelve a intentarlo.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function changed() {
    await load();
    window.dispatchEvent(new Event('sharepoint-sources-changed'));
  }
  const fields = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const kind = String(data.get('audienceKind'));
    return {
      recursive: data.has('recursive'),
      intervalMinutes: Number(data.get('intervalMinutes')),
      reviewOnly: !data.has('useForReplies'),
      audience: {
        kind,
        key:
          kind === 'GENERAL'
            ? ''
            : String(data.get('audienceKey') ?? '')
                .trim()
                .toLowerCase(),
      },
    };
  };
  function policy(c?: SharePointConnector) {
    return (
      <>
        <label>
          <input
            type="checkbox"
            name="recursive"
            defaultChecked={c?.recursive ?? true}
          />{' '}
          Incluir subcarpetas
        </label>
        <label>
          Actualizar cada (minutos)
          <input
            type="number"
            name="intervalMinutes"
            min={5}
            max={1440}
            defaultValue={c?.interval_minutes ?? 15}
            required
          />
        </label>
        <label>
          Información permitida para
          <select
            name="audienceKind"
            defaultValue={c?.audience_kind ?? 'DOMAIN'}
          >
            <option value="DOMAIN">Un dominio de destinatarios</option>
            <option value="RECIPIENT">Un destinatario</option>
            <option value="GENERAL">
              Cualquier destinatario autorizado por las reglas
            </option>
          </select>
        </label>
        <label>
          Dominio o correo (vacío para cualquier destinatario)
          <input
            name="audienceKey"
            defaultValue={c?.audience_key ?? ''}
            placeholder="cliente.es"
            maxLength={254}
          />
        </label>
        <label>
          <input
            type="checkbox"
            name="useForReplies"
            defaultChecked={c ? !c.review_only : false}
          />{' '}
          Habilitar esta información para preparar respuestas
        </label>
        <p className="description">
          Activa el uso cuando hayas revisado el alcance y los destinatarios.
          Después configura sus reglas de consulta. Poder leer un documento en
          Microsoft no significa que deba compartirse en cualquier correo.
        </p>
      </>
    );
  }
  async function showFiles(id: string, page = 0) {
    const result = await json(
      await fetch(
        `/api/knowledge/connectors?id=${encodeURIComponent(id)}&offset=${page}`,
        { cache: 'no-store' },
      ),
    );
    setFiles(result.items);
    setFileConnector(id);
    setOffset(page);
  }
  function save(event: FormEvent<HTMLFormElement>, c?: SharePointConnector) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void execute(async () => {
      if (c) await act({ action: 'configure', id: c.id, ...fields(form) });
      else {
        if (!browse?.folder || !drive) throw new Error('FOLDER_REQUIRED');
        await act({
          action: 'create',
          connectionId: connection,
          title: String(data.get('title')),
          siteId: browse.site.id,
          driveId: drive,
          rootId: browse.folder.id,
          ...fields(form),
        });
      }
      await changed();
      setMessage(
        'Fuente guardada. La sincronización continuará en segundo plano.',
      );
    });
  }
  return (
    <section
      className="knowledge-sources"
      aria-labelledby="sharepoint-title"
      aria-busy={busy}
    >
      <h2 id="sharepoint-title">Carpetas de SharePoint</h2>
      <MicrosoftConnectionNotice result={oauthResult} />
      <p className="description">
        Conecta carpetas y subcarpetas de Microsoft 365. El contenido se indexa
        y se actualiza periódicamente; se comprueban los permisos y la versión
        antes de usarlo en una respuesta.
      </p>
      {message && (
        <p role="status" aria-live="polite" className="description">
          {message}
        </p>
      )}
      {message === errors.PRIVACY_CONSENT_REQUIRED && (
        <a href="/privacy-consent">Revisar información de privacidad</a>
      )}
      {!snapshot ? (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void execute(load)}
          disabled={busy}
        >
          Volver a cargar conexiones
        </button>
      ) : !snapshot.enabled ? (
        <p className="description">
          SharePoint está pendiente de configuración en el servidor.
        </p>
      ) : (
        <>
          <p className="form-message" role="status">
            {snapshot.connections.length
              ? `Cuentas Microsoft vinculadas: ${snapshot.connections.length}.`
              : 'No hay ninguna cuenta Microsoft vinculada.'}
          </p>
          <p className="description">
            PDF, Word, TXT, Excel, CSV, PowerPoint, Markdown y HTML. OCR de
            escaneos e imágenes:{' '}
            {snapshot.ocrConfigured
              ? 'configurado'
              : 'pendiente de configuración'}
            . Los archivos no legibles se muestran con su causa. Máximo 5.000
            archivos importados por cuenta, 50 MB por archivo y 2 GB de
            originales procesados en el índice activo.
          </p>
          <form
            className="execution-form"
            onSubmit={(event) => {
              event.preventDefault();
              void execute(async () => {
                const result = await json(
                  await fetch('/api/connectors/microsoft/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acknowledged: ack }),
                  }),
                );
                window.location.assign(result.url);
              });
            }}
          >
            <label>
              <input
                type="checkbox"
                required
                checked={ack}
                onChange={(event) => setAck(event.target.checked)}
              />{' '}
              Autorizo la lectura y el procesamiento del contenido elegido para
              preparar respuestas. Microsoft puede conceder lectura de sitios
              más amplia que las carpetas seleccionadas; la app limita qué
              contenido incorpora. El OCR, si está configurado, utiliza Azure
              Document Intelligence.
            </label>
            <button className="button button-secondary" disabled={busy || !ack}>
              {snapshot.connections.length
                ? 'Conectar otra cuenta Microsoft'
                : 'Conectar cuenta Microsoft'}
            </button>
          </form>
          <ul className="documents-list">
            {snapshot.connections.map((c) => (
              <li key={c.id}>
                <strong>{c.username}</strong> ·{' '}
                {c.status === 'CONNECTED' ? 'Conectada' : 'Necesita reconexión'}{' '}
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void execute(async () => {
                      await act({ action: 'disconnect', id: c.id });
                      setConnection('');
                      setBrowse(null);
                      setFiles([]);
                      await changed();
                      setMessage(
                        'Cuenta desconectada. Sus fuentes e índices se han retirado.',
                      );
                    })
                  }
                >
                  Desconectar y retirar copias locales
                </button>
              </li>
            ))}
          </ul>
          {!!snapshot.connections.length && (
            <details>
              <summary>Añadir carpeta</summary>
              <form
                className="execution-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void execute(async () => {
                    setBrowse(
                      await act({
                        action: 'browse',
                        connectionId: connection,
                        siteUrl,
                      }),
                    );
                    setDrive('');
                    setPath([]);
                  });
                }}
              >
                <label>
                  Cuenta Microsoft
                  <select
                    value={connection}
                    onChange={(event) => {
                      setConnection(event.target.value);
                      setBrowse(null);
                    }}
                    required
                  >
                    {snapshot.connections
                      .filter((c) => c.status === 'CONNECTED')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.username}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  URL del sitio SharePoint
                  <input
                    type="url"
                    value={siteUrl}
                    onChange={(event) => setSiteUrl(event.target.value)}
                    placeholder="https://empresa.sharepoint.com/sites/Comercial"
                    required
                  />
                </label>
                <button className="button button-secondary" disabled={busy}>
                  Ver bibliotecas
                </button>
              </form>
              {browse?.drives && (
                <ul>
                  {browse.drives.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() =>
                          void execute(async () => {
                            setBrowse(
                              await act({
                                action: 'browse',
                                connectionId: connection,
                                siteId: browse.site.id,
                                driveId: d.id,
                              }),
                            );
                            setDrive(d.id);
                            setPath([]);
                          })
                        }
                      >
                        {d.name ?? 'Biblioteca'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {browse?.folder && (
                <>
                  <p>
                    Carpeta seleccionada:{' '}
                    <strong>
                      {[...path.map((p) => p.name), browse.folder.name]
                        .filter(Boolean)
                        .join(' / ') || 'Raíz de biblioteca'}
                    </strong>
                  </p>
                  {!!path.length && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void execute(async () => {
                          const parent = path.at(-1)!;
                          setBrowse(
                            await act({
                              action: 'browse',
                              connectionId: connection,
                              siteId: browse.site.id,
                              driveId: drive,
                              itemId: parent.id,
                            }),
                          );
                          setPath(path.slice(0, -1));
                        })
                      }
                    >
                      Subir un nivel
                    </button>
                  )}
                  <ul>
                    {browse.folders?.map((folder) => (
                      <li key={folder.id}>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() =>
                            void execute(async () => {
                              const previous = browse.folder!;
                              setBrowse(
                                await act({
                                  action: 'browse',
                                  connectionId: connection,
                                  siteId: browse.site.id,
                                  driveId: drive,
                                  itemId: folder.id,
                                }),
                              );
                              setPath([...path, previous]);
                            })
                          }
                        >
                          {folder.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {browse.next && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() =>
                        void execute(async () => {
                          const next = await act({
                            action: 'browse',
                            connectionId: connection,
                            siteId: browse.site.id,
                            driveId: drive,
                            itemId: browse.folder!.id,
                            next: browse.next,
                          });
                          setBrowse({
                            ...next,
                            folders: [
                              ...(browse.folders ?? []),
                              ...(next.folders ?? []),
                            ],
                          });
                        })
                      }
                    >
                      Más carpetas
                    </button>
                  )}
                  <form
                    className="execution-form"
                    onSubmit={(event) => save(event)}
                  >
                    <label>
                      Nombre de la fuente
                      <input
                        name="title"
                        required
                        maxLength={100}
                        placeholder="Tarifas comerciales"
                      />
                    </label>
                    {policy()}
                    <button className="button button-secondary" disabled={busy}>
                      Conectar esta carpeta
                    </button>
                  </form>
                </>
              )}
            </details>
          )}
          <ul className="documents-list">
            {snapshot.connectors.map((c) => (
              <li key={c.id}>
                <strong>{c.title}</strong> ·{' '}
                {c.status === 'PAUSED'
                  ? 'Sincronización pausada'
                  : c.phase === 'IDLE'
                    ? 'Última pasada terminada'
                    : 'Sincronización en curso'}
                <p>
                  <a href={c.web_url} target="_blank" rel="noopener noreferrer">
                    Abrir carpeta en SharePoint
                  </a>
                </p>
                <p className="description">
                  {c.ready ?? 0} indexados · {c.pending ?? 0} pendientes ·{' '}
                  {c.omitted ?? 0} omitidos · {c.failed ?? 0} con error. Uso en
                  respuestas:{' '}
                  {c.review_only
                    ? 'pendiente de habilitar'
                    : 'habilitado según reglas y audiencia'}
                  .
                </p>
                <p className="description">
                  Última sincronización:{' '}
                  {c.last_sync_at
                    ? new Date(c.last_sync_at).toLocaleString('es-ES', {
                        timeZone: 'Europe/Madrid',
                      })
                    : 'pendiente'}{' '}
                  · Cada {c.interval_minutes} minutos.
                </p>
                {c.error_code && (
                  <p role="alert">
                    {errors[c.error_code] ??
                      `Sincronización pendiente: ${c.error_code}`}
                  </p>
                )}
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void execute(async () => {
                      await act({ action: 'sync', id: c.id });
                      await changed();
                    })
                  }
                >
                  Sincronizar ahora y reintentar errores
                </button>{' '}
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void execute(async () => {
                      await act({
                        action: c.status === 'PAUSED' ? 'resume' : 'pause',
                        id: c.id,
                      });
                      await changed();
                    })
                  }
                >
                  {c.status === 'PAUSED'
                    ? 'Reanudar sincronización'
                    : 'Pausar sincronización'}
                </button>{' '}
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void execute(() => showFiles(c.id))}
                >
                  Ver archivos y errores
                </button>
                <details>
                  <summary>Configurar alcance y uso</summary>
                  <form
                    className="execution-form"
                    key={c.version}
                    onSubmit={(event) => save(event, c)}
                  >
                    {policy(c)}
                    <button className="button button-secondary" disabled={busy}>
                      Guardar configuración
                    </button>
                  </form>
                </details>
                <details>
                  <summary>Retirar esta carpeta</summary>
                  <p>
                    Se retirarán sus textos e índices locales. Los documentos
                    originales de SharePoint se conservan.
                  </p>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() =>
                      void execute(async () => {
                        await act({ action: 'remove', id: c.id });
                        setFiles([]);
                        await changed();
                      })
                    }
                  >
                    Desconectar carpeta y retirar índice
                  </button>
                </details>
              </li>
            ))}
          </ul>
          {fileConnector && (
            <div>
              <h3>Archivos de la carpeta</h3>
              <ul className="documents-list">
                {files.map((f) => (
                  <li key={f.item_id}>
                    <strong>{f.name}</strong> · {f.status}
                    {f.error_code && (
                      <p>{errors[f.error_code] ?? f.error_code}</p>
                    )}
                    {f.web_url && (
                      <a
                        href={f.web_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Revisar original
                      </a>
                    )}
                    <details>
                      <summary>
                        Restringir destinatarios de este archivo
                      </summary>
                      <form
                        className="execution-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          const kind = String(data.get('kind'));
                          void execute(async () => {
                            await act({
                              action: 'file_audience',
                              id: fileConnector,
                              itemId: f.item_id,
                              audience:
                                kind === 'INHERIT'
                                  ? null
                                  : {
                                      kind,
                                      key:
                                        kind === 'GENERAL'
                                          ? ''
                                          : String(data.get('key') ?? '')
                                              .trim()
                                              .toLowerCase(),
                                    },
                            });
                            await changed();
                            await showFiles(fileConnector, offset);
                          });
                        }}
                      >
                        <label>
                          Audiencia
                          <select
                            name="kind"
                            defaultValue={f.audience_kind ?? 'INHERIT'}
                          >
                            <option value="INHERIT">
                              Heredar de la carpeta
                            </option>
                            <option value="GENERAL">
                              General (si la carpeta lo permite)
                            </option>
                            <option value="DOMAIN">Un dominio</option>
                            <option value="RECIPIENT">Un destinatario</option>
                          </select>
                        </label>
                        <label>
                          Dominio o correo
                          <input
                            name="key"
                            defaultValue={f.audience_key ?? ''}
                            maxLength={254}
                          />
                        </label>
                        <button
                          className="button button-secondary"
                          disabled={busy}
                        >
                          Guardar excepción
                        </button>
                      </form>
                    </details>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || offset === 0}
                onClick={() =>
                  void execute(() =>
                    showFiles(fileConnector, Math.max(0, offset - 100)),
                  )
                }
              >
                Anterior
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || files.length < 100}
                onClick={() =>
                  void execute(() => showFiles(fileConnector, offset + 100))
                }
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
