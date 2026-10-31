import Link from 'next/link';
import {
  requireAccount,
  getWorkspaceGmail,
  getRecentRuns,
} from '@/app/_lib/workspace';
import {
  PageHeader,
  Panel,
  GmailSummary,
  RunList,
  StatusBadge,
  UnavailableState,
} from '../components';
import { Notices, type WorkspaceSearchParams } from '../notices';

export const metadata = { title: 'Resumen · Auto Email' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: WorkspaceSearchParams;
}) {
  const account = await requireAccount();
  const [gmail, runs] = await Promise.allSettled([
    getWorkspaceGmail(),
    getRecentRuns(),
  ]);
  const canAutomate =
    gmail.status === 'fulfilled' && gmail.value?.status === 'CONNECTED';
  return (
    <>
      <PageHeader
        title="Tu correo, con tu voz."
        description="Consulta el estado de tu asistente y continúa donde lo dejaste."
      />
      <Notices params={await searchParams} />
      <div className="workspace-grid">
        <Panel title="Conexión con Gmail">
          {gmail.status === 'fulfilled' ? (
            <GmailSummary account={gmail.value} />
          ) : (
            <UnavailableState>
              No podemos consultar tu conexión con Gmail.
            </UnavailableState>
          )}
          <Link className="text-link" href="/settings">
            Gestionar conexión →
          </Link>
        </Panel>
        <Panel title="Automatización">
          <StatusBadge
            tone={
              account.settings.automationEnabled && canAutomate
                ? 'success'
                : 'neutral'
            }
          >
            {!account.settings.automationEnabled
              ? 'Desactivada'
              : gmail.status === 'rejected'
                ? 'Estado no disponible'
                : canAutomate
                  ? 'Activada'
                  : 'Pendiente de conexión'}
          </StatusBadge>
          <dl className="settings-list">
            <div>
              <dt>Intervalo de comprobación</dt>
              <dd>{account.settings.pollIntervalSeconds} segundos</dd>
            </div>
            <div>
              <dt>Límite diario</dt>
              <dd>{account.settings.maxDailyDrafts} borradores</dd>
            </div>
          </dl>
          <Link className="text-link" href="/settings">
            Configurar asistente →
          </Link>
        </Panel>
      </div>
      <Panel title="Actividad reciente">
        {runs.status === 'fulfilled' ? (
          <RunList runs={runs.value.slice(0, 3)} />
        ) : (
          <UnavailableState>
            No podemos cargar la actividad reciente.
          </UnavailableState>
        )}
        <Link className="text-link" href="/activity">
          Ver actividad →
        </Link>
      </Panel>
      <div className="workspace-grid">
        <Panel title="Tu forma de escribir">
          <p className="description">
            Consulta el estado del perfil que personaliza tus respuestas.
          </p>
          <Link className="text-link" href="/style">
            Ir a mi estilo →
          </Link>
        </Panel>
        <Panel title="Respuestas con contexto">
          <p className="description">
            Incorpora documentos y gestiona las fuentes que puede consultar tu
            asistente.
          </p>
          <Link className="text-link" href="/knowledge">
            Gestionar conocimiento →
          </Link>
        </Panel>
      </div>
    </>
  );
}
