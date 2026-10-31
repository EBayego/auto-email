import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="workspace-panel">
      <h1 className="error-title">Sección no encontrada</h1>
      <p className="description">Esta sección no está disponible.</p>
      <Link href="/dashboard" className="button button-secondary">
        Volver al resumen
      </Link>
    </section>
  );
}
