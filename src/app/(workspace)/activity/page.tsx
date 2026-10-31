import Link from 'next/link';
import { requireAccount } from '@/app/_lib/workspace';
import { getActivity } from '@/app/_lib/activity';
import { activityQuerySchema } from '@/modules/workflow/activity';
import { PageHeader, Panel, UnavailableState } from '../components';
import { ActivityView } from './activity-view';

export const metadata = { title: 'Actividad · Auto Email' };

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccount();
  const parsed = activityQuerySchema.safeParse(await searchParams);
  const [feed] = parsed.success
    ? await Promise.allSettled([
        getActivity().then((access) => access.feed(parsed.data)),
      ])
    : [];
  return (
    <>
      <PageHeader
        title="Lo que hace tu asistente."
        description="Consulta qué mensajes se han procesado, por qué se han omitido y qué borradores se han creado."
      />
      {!parsed.success ? (
        <Panel title="Filtros de actividad">
          <p className="form-error">Los filtros de actividad no son válidos.</p>
          <Link className="text-link" href="/activity">
            Ver la actividad reciente
          </Link>
        </Panel>
      ) : feed?.status === 'fulfilled' ? (
        <ActivityView feed={feed.value} query={parsed.data} />
      ) : (
        <Panel title="Actividad">
          <UnavailableState>
            No podemos cargar tu actividad. Vuelve a intentarlo.
          </UnavailableState>
        </Panel>
      )}
    </>
  );
}
