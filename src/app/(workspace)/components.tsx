import Link from 'next/link';
import type { ReactNode } from 'react';
import type { GmailAccount, ProcessingRun } from '@/db/models';
import { RetryButton } from './retry-button';

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="page-heading">
      <p className="eyebrow">Tu asistente de correo</p>
      <h1>{title}</h1>
      <p className="description">{description}</p>
    </header>
  );
}

export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="workspace-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p className="description">{children}</p>
      {href && action && (
        <Link className="button button-secondary" href={href}>
          {action}
        </Link>
      )}
    </div>
  );
}

export function UnavailableState({ children }: { children: ReactNode }) {
  return (
    <div className="unavailable-state">
      <p className="form-error" role="alert">
        {children}
      </p>
      <RetryButton />
    </div>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function DateTime({
  value,
  empty = 'Todavía no disponible',
}: {
  value: string | null;
  empty?: string;
}) {
  if (!value || !Number.isFinite(Date.parse(value)))
    return <span>{empty}</span>;
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Madrid',
      }).format(new Date(value))}
    </time>
  );
}

const gmailStates = {
  CONNECTED: ['Conectada', 'success'],
  PAUSED: ['Pausada', 'warning'],
  DISCONNECTED: ['Desconectada', 'neutral'],
  REAUTH_REQUIRED: ['Necesita autorización', 'danger'],
} as const;

export function GmailSummary({ account }: { account: GmailAccount | null }) {
  if (!account)
    return (
      <EmptyState
        title="Conecta tu cuenta Gmail"
        href="/onboarding"
        action="Empezar configuración"
      >
        Vincula tu correo para preparar respuestas con tu estilo.
      </EmptyState>
    );
  const [label, tone] = gmailStates[
    account.status as keyof typeof gmailStates
  ] ?? ['No disponible', 'neutral'];
  return (
    <>
      <div className="panel-heading">
        <p className="account-email">{account.email}</p>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
      <p className="description">
        Última sincronización:{' '}
        <DateTime
          value={account.last_sync_at}
          empty="Aún no se ha sincronizado"
        />
        .
      </p>
      {account.status === 'REAUTH_REQUIRED' && (
        <p className="form-error" role="alert">
          Vuelve a autorizar Gmail para continuar con la preparación de
          borradores.
        </p>
      )}
    </>
  );
}

const runStates: Record<
  string,
  [string, 'neutral' | 'success' | 'warning' | 'danger']
> = {
  RUNNING: ['En curso', 'warning'],
  COMPLETED: ['Completada', 'success'],
  FAILED: ['Fallida', 'danger'],
  CANCELLED: ['Cancelada', 'neutral'],
};
const triggers: Record<string, string> = {
  MANUAL: 'Revisión manual',
  SCHEDULED: 'Revisión programada',
  RETRY: 'Reintento',
};

export function RunList({ runs }: { runs: ProcessingRun[] }) {
  if (!runs.length)
    return (
      <EmptyState title="Aún no hay actividad">
        Las revisiones de correo aparecerán aquí cuando se ejecute el asistente.
      </EmptyState>
    );
  return (
    <ul className="run-list">
      {runs.map((run) => {
        const [label, tone] = runStates[run.status] ?? [
          'No disponible',
          'neutral',
        ];
        return (
          <li key={run.id}>
            <div className="panel-heading">
              <h3>{triggers[run.trigger_kind] ?? 'Revisión de correo'}</h3>
              <StatusBadge tone={tone}>{label}</StatusBadge>
            </div>
            <p className="description">
              <DateTime value={run.started_at} /> · Hora de Madrid
            </p>
            <dl className="run-metrics">
              <div>
                <dt>Detectados</dt>
                <dd>{run.messages_detected}</dd>
              </div>
              <div>
                <dt>Procesados</dt>
                <dd>{run.messages_processed}</dd>
              </div>
              <div>
                <dt>Borradores</dt>
                <dd>{run.drafts_created}</dd>
              </div>
              <div>
                <dt>Errores</dt>
                <dd>{run.error_count}</dd>
              </div>
            </dl>
            {run.status === 'FAILED' && (
              <p className="form-error">
                No se ha completado esta revisión. Comprueba la conexión y los
                ajustes antes de reintentar.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
