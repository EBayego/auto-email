'use client';

import Link from 'next/link';
import { RetryButton } from './retry-button';

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="workspace-panel">
      <h1 className="error-title">No podemos cargar esta sección</h1>
      <p role="alert" className="form-error">
        Se ha producido un problema al consultar tus datos. Vuelve a intentarlo
        en unos instantes.
      </p>
      <div className="workspace-actions">
        <RetryButton reset={reset} />
        <Link href="/dashboard" className="button button-secondary">
          Volver al resumen
        </Link>
      </div>
    </section>
  );
}
