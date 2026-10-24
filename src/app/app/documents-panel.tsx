'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { DocumentMetadata } from '@/modules/knowledge/documents';
import type { KnowledgeSearchMatch } from '@/modules/knowledge/document-index';
import { KnowledgeSourcesPanel } from './knowledge-sources-panel';

const messages: Record<string, string> = {
  INVALID_FILE: 'Selecciona un archivo válido.',
  INVALID_FORMAT:
    'El contenido, la extensión o el tipo del archivo no son válidos.',
  FILE_TOO_LARGE: 'El archivo supera los 10 MB.',
  UNSAFE_FILE:
    'El documento contiene elementos no admitidos o supera los límites de seguridad.',
  NO_TEXT:
    'El documento no tiene texto extraíble. Los PDF escaneados necesitan OCR y todavía no se admiten.',
  TEXT_LIMIT: 'El documento supera el límite de texto o de páginas.',
  PARSER_TIMEOUT:
    'No se ha podido procesar el documento en el tiempo permitido.',
  DOCUMENT_LIMIT: 'Ya tienes 10 documentos. Elimina uno antes de subir otro.',
  DOCUMENT_BUSY:
    'Hay una carga en curso. Espera a que termine y vuelve a intentarlo.',
};
const statuses: Record<string, string> = {
  PROCESSING: 'Procesando',
  READY: 'Texto extraído',
  FAILED: 'Error de procesamiento',
  DELETING: 'Eliminación pendiente',
};

export function DocumentsPanel() {
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [matches, setMatches] = useState<KnowledgeSearchMatch[]>([]);
  const [searched, setSearched] = useState(false);
  async function refresh() {
    const response = await fetch('/api/knowledge/documents', {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('UNAVAILABLE');
    setDocuments((await response.json()).documents);
  }
  async function setValidity(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('Guardando vigencia…');
    try {
      const response = await fetch(`/api/knowledge/documents/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          validFrom: form.get('validFrom') || null,
          validUntil: form.get('validUntil') || null,
        }),
      });
      if (!response.ok) throw new Error();
      setMatches([]);
      setSearched(false);
      await refresh();
      setMessage('Vigencia actualizada.');
    } catch {
      setMessage('No se pudo guardar. Revisa el intervalo de fechas.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    fetch('/api/knowledge/documents', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((body) => {
        if (active) setDocuments(body.documents);
      })
      .catch(() => {
        if (active) setMessage('No se pueden cargar tus documentos.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage('Procesando documento…');
    try {
      const response = await fetch('/api/knowledge/documents', {
        method: 'POST',
        body: new FormData(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      form.reset();
      setMessage('Documento incorporado.');
    } catch (error) {
      setMessage(
        messages[(error as Error).message] ??
          'No se pudo incorporar el documento. Vuelve a intentarlo.',
      );
    } finally {
      await refresh().catch(() =>
        setMessage('No se pudo actualizar la lista. Recarga la página.'),
      );
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setMatches([]);
    setSearched(false);
    setBusy(true);
    setMessage('Eliminando documento…');
    try {
      const response = await fetch(`/api/knowledge/documents/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setMessage('Documento y texto extraído eliminados.');
    } catch (error) {
      setMessage(
        messages[(error as Error).message] ??
          'No se pudo completar la eliminación. Puedes reintentarlo.',
      );
    } finally {
      await refresh().catch(() =>
        setMessage('No se pudo actualizar la lista. Recarga la página.'),
      );
      setBusy(false);
    }
  }
  async function reindex(id: string) {
    setBusy(true);
    setMatches([]);
    setSearched(false);
    setMessage('Indexando documento…');
    try {
      const response = await fetch(`/api/knowledge/documents/${id}/index`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setMessage('Documento indexado.');
    } catch (error) {
      setMessage(
        messages[(error as Error).message] ??
          'No se ha podido indexar el documento. Puedes reintentarlo.',
      );
    } finally {
      await refresh().catch(() =>
        setMessage('No se pudo actualizar la lista.'),
      );
      setBusy(false);
    }
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMatches([]);
    setSearched(false);
    setMessage('Buscando…');
    const query = String(new FormData(event.currentTarget).get('q') ?? '');
    try {
      const response = await fetch(
        `/api/knowledge/search?${new URLSearchParams({ q: query })}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error();
      setMatches((await response.json()).matches);
      setSearched(true);
      setMessage('');
    } catch {
      setMessage('No se ha podido completar la búsqueda.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="documents-title" className="documents-panel">
      <h2 id="documents-title">Documentos de conocimiento</h2>
      <p className="description">
        PDF con texto, TXT en UTF-8 y DOCX. Hasta 10 documentos de 10 MB cada
        uno.
      </p>
      <form onSubmit={upload} className="execution-form">
        <label>
          Seleccionar documento
          <input
            type="file"
            name="file"
            accept=".pdf,.txt,.docx"
            required
            disabled={busy}
          />
        </label>
        <button
          className="button button-secondary"
          disabled={busy || documents.length >= 10}
        >
          Subir documento
        </button>
      </form>
      {message && (
        <p role="status" aria-live="polite" className="description">
          {message}
        </p>
      )}
      <ul className="documents-list" aria-busy={busy}>
        {documents.map((document) => (
          <li key={document.id}>
            <strong>{document.name}</strong>
            <p className="description">
              {statuses[document.status]} · Versión {document.version} ·{' '}
              {Math.ceil(document.byte_size / 1024)} KB ·{' '}
              {new Date(document.uploaded_at).toLocaleDateString('es-ES', {
                timeZone: 'Europe/Madrid',
              })}
              {document.status === 'READY' &&
                (document.indexed_at
                  ? ` · ${document.chunk_count} fragmentos`
                  : ' · Indexación pendiente')}
            </p>
            {document.status === 'READY' && (
              <details>
                <summary>Vigencia del contenido</summary>
                <p className="description">
                  Indica las fechas que establece el documento. Deja los campos
                  vacíos si no conoces su vigencia. Los días se evalúan en UTC.
                </p>
                <form
                  className="execution-form"
                  onSubmit={(event) => void setValidity(event, document.id)}
                >
                  <label>
                    Válido desde
                    <input
                      type="date"
                      name="validFrom"
                      defaultValue={document.valid_from ?? ''}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Válido hasta (incluido)
                    <input
                      type="date"
                      name="validUntil"
                      defaultValue={document.valid_until ?? ''}
                      disabled={busy}
                    />
                  </label>
                  <button className="button button-secondary" disabled={busy}>
                    Guardar vigencia
                  </button>
                </form>
              </details>
            )}
            {document.error_code && (
              <p className="form-error">
                {messages[document.error_code] ??
                  'No se ha podido procesar el documento.'}
              </p>
            )}
            {document.status === 'READY' && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => void reindex(document.id)}
              >
                {document.indexed_at ? 'Indexar de nuevo' : 'Indexar documento'}
              </button>
            )}
            {document.status === 'READY' && (
              <a
                href={`/api/knowledge/documents/${document.id}`}
                className="button button-secondary"
              >
                Descargar
              </a>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void remove(document.id)}
            >
              {' '}
              {document.status === 'DELETING'
                ? 'Reintentar eliminación'
                : 'Eliminar documento'}
            </button>
          </li>
        ))}
      </ul>
      {!busy && documents.length === 0 && (
        <p className="description">Todavía no has incorporado documentos.</p>
      )}
      <KnowledgeSourcesPanel documents={documents} onUpdated={refresh} />
      <form
        onSubmit={search}
        className="execution-form"
        role="search"
        aria-label="Buscar en tus documentos"
      >
        <label>
          Buscar en tus documentos
          <input
            name="q"
            type="search"
            maxLength={300}
            required
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className="button button-secondary"
          disabled={busy}
        >
          Buscar
        </button>
      </form>
      {searched && (
        <p role="status" className="description">
          {matches.length
            ? `${matches.length} fragmentos encontrados.`
            : 'No se han encontrado fragmentos para esta búsqueda.'}
        </p>
      )}
      <ul className="documents-list">
        {matches.map((match) => (
          <li key={match.chunk_id}>
            <a href={`/api/knowledge/documents/${match.document_id}`}>
              <strong>{match.document_name}</strong>
            </a>
            <p className="description">
              Versión {match.version}
              {match.section && ` · ${match.section}`}
              {match.page_start &&
                ` · Página ${match.page_start}${match.page_end !== match.page_start ? `–${match.page_end}` : ''}`}
            </p>
            <p className="knowledge-excerpt">{match.content}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
