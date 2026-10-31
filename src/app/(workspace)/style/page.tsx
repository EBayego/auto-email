import { requireAccount, getWorkspaceGmail } from '@/app/_lib/workspace';
import { getStyleEditorAccess } from '@/app/_lib/style-editor';
import { PageHeader, Panel, EmptyState, UnavailableState } from '../components';
import { StyleScreen } from './style-screen';

export const metadata = { title: 'Mi estilo · Auto Email' };

export default async function StylePage() {
  await requireAccount();
  const [gmail] = await Promise.allSettled([getWorkspaceGmail()]);
  const [style] =
    gmail.status === 'fulfilled' && gmail.value?.status === 'CONNECTED'
      ? await Promise.allSettled([
          getStyleEditorAccess().then((access) => access.get()),
        ])
      : [];
  return (
    <>
      <PageHeader
        title="Tu forma de escribir."
        description="Revisa tu estilo aprendido y ajusta cómo quieres que se redacten tus próximas respuestas."
      />
      {gmail.status === 'rejected' || style?.status === 'rejected' ? (
        <UnavailableState>
          No podemos consultar tu perfil de escritura.
        </UnavailableState>
      ) : !gmail.value || gmail.value.status !== 'CONNECTED' ? (
        <Panel title="Perfil de escritura">
          <EmptyState
            title="Conecta Gmail para consultar tu estilo"
            href="/onboarding"
            action="Ir a primeros pasos"
          >
            Necesitamos una conexión activa con la cuenta a la que pertenece tu
            perfil.
          </EmptyState>
        </Panel>
      ) : style?.status === 'fulfilled' && style.value ? (
        <StyleScreen initial={style.value} />
      ) : (
        <Panel title="Perfil de escritura">
          <EmptyState
            title="Tu perfil todavía no está disponible"
            href="/onboarding"
            action="Preparar mi perfil de escritura"
          >
            Analiza una muestra de tus enviados para obtener un perfil que
            después podrás revisar y personalizar aquí.
          </EmptyState>
        </Panel>
      )}
    </>
  );
}
