export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="workspace-loading"
    >
      <span>Cargando tu espacio…</span>
      <div className="skeleton skeleton-title" aria-hidden="true" />
      <div className="workspace-grid" aria-hidden="true">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
    </div>
  );
}
