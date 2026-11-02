import { requireAccount, getWorkspaceGmail } from '@/app/_lib/workspace';
import {
  PageHeader,
  Panel,
  GmailSummary,
  UnavailableState,
} from '../components';
import { GmailControls } from '../gmail-controls';
import { Notices, type WorkspaceSearchParams } from '../notices';
import { getAutomationSettings } from '@/app/_lib/automation-settings';
import { getKnowledgeSources } from '@/app/_lib/knowledge-sources';
import { SettingsContent } from './settings-content';
import { AccountDataControls } from './account-data-controls';
import { GenerationRetentionPanel } from './generation-retention-panel';
import { PrivacyPanel } from './privacy-panel';

export const metadata = { title: 'Ajustes · Auto Email' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: WorkspaceSearchParams;
}) {
  const account = await requireAccount();
  const [gmail, settings, sources] = await Promise.allSettled([
    getWorkspaceGmail(),
    getAutomationSettings().then((access) => access.get()),
    getKnowledgeSources().then((access) => access.list()),
  ]);
  return (
    <>
      <PageHeader
        title="Tú marcas el ritmo."
        description="Elige qué correos procesar, las fuentes que puede consultar el asistente y los límites de sus propuestas."
      />
      <Notices params={await searchParams} />
      <PrivacyPanel />
      <Panel title="Cuenta Gmail">
        {gmail.status === 'fulfilled' ? (
          <>
            <GmailSummary account={gmail.value} />
            <GmailControls account={gmail.value} />
          </>
        ) : (
          <UnavailableState>
            No podemos consultar tu conexión con Gmail.
          </UnavailableState>
        )}
      </Panel>
      {settings.status !== 'fulfilled' && (
        <Panel title="Automatización y restricciones">
          <UnavailableState>
            No podemos consultar tu configuración.
          </UnavailableState>
        </Panel>
      )}
      <SettingsContent
        initial={settings.status === 'fulfilled' ? settings.value : null}
        sources={sources.status === 'fulfilled' ? sources.value : null}
        connected={
          gmail.status === 'fulfilled' && gmail.value?.status === 'CONNECTED'
        }
      />
      {gmail.status === 'fulfilled' && gmail.value?.status === 'CONNECTED' && (
        <GenerationRetentionPanel
          key={gmail.value.id}
          accountId={gmail.value.id}
        />
      )}
      <AccountDataControls email={account.user.email} />
    </>
  );
}
