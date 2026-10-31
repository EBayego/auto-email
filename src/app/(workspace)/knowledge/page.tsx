import { requireAccount } from '@/app/_lib/workspace';
import { DocumentsPanel } from '@/app/app/documents-panel';
import { PageHeader } from '../components';

export const metadata = { title: 'Conocimiento · Auto Email' };

export default async function KnowledgePage() {
  await requireAccount();
  return (
    <>
      <PageHeader
        title="El contexto que necesita."
        description="Gestiona tus documentos y las fuentes autorizadas para fundamentar las respuestas."
      />
      <div className="workspace-panel knowledge-panel">
        <DocumentsPanel />
      </div>
    </>
  );
}
