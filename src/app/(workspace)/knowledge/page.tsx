import { requireAccount } from '@/app/_lib/workspace';
import { DocumentsPanel } from '@/app/app/documents-panel';
import { SharePointPanel } from '@/app/app/sharepoint-panel';
import { PageHeader } from '../components';
import type { WorkspaceSearchParams } from '../notices';

export const metadata = { title: 'Conocimiento · Auto Email' };

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: WorkspaceSearchParams;
}) {
  await requireAccount();
  const params = await searchParams;
  return (
    <>
      <PageHeader
        title="El contexto que necesita."
        description="Gestiona tus documentos y las fuentes autorizadas para fundamentar las respuestas."
      />
      <div className="workspace-panel knowledge-panel">
        <SharePointPanel
          oauthResult={
            typeof params.microsoft === 'string' ? params.microsoft : undefined
          }
        />
        <DocumentsPanel />
      </div>
    </>
  );
}
