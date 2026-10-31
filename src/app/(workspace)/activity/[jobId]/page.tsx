import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccount, getWorkspaceGmail } from '@/app/_lib/workspace';
import { getActivity } from '@/app/_lib/activity';
import { DataAccessError } from '@/db/errors';
import { activityQuerySchema } from '@/modules/workflow/activity';
import { PageHeader, Panel, UnavailableState } from '../../components';
import { ActivityDetailView, activityHref } from '../activity-view';
export const metadata = { title: 'Detalle de actividad · Auto Email' };
export default async function ActivityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAccount();
  const query = activityQuerySchema.safeParse(await searchParams);
  const { jobId } = await params;
  const [detail, gmail] = await Promise.allSettled([
    getActivity().then((access) => access.detail(jobId)),
    getWorkspaceGmail(),
  ]);
  if (
    detail.status === 'rejected' &&
    detail.reason instanceof DataAccessError &&
    ['NOT_FOUND', 'INVALID_INPUT'].includes(detail.reason.code)
  )
    notFound();
  return (
    <>
      <PageHeader
        title="El recorrido de una respuesta."
        description="Estados, motivos y referencias de este mensaje, sin copiar su contenido."
      />
      <Link
        className="text-link activity-back"
        href={
          query.success
            ? activityHref({ status: query.data.status })
            : '/activity'
        }
      >
        ← Volver a la actividad
      </Link>
      {detail.status === 'fulfilled' && gmail.status === 'fulfilled' ? (
        <ActivityDetailView
          detail={detail.value}
          email={gmail.value?.email ?? null}
        />
      ) : (
        <Panel title="Detalle de actividad">
          <UnavailableState>
            No podemos cargar este detalle. Vuelve a intentarlo.
          </UnavailableState>
        </Panel>
      )}
    </>
  );
}
