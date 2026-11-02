import Link from 'next/link';
import { requireAccount } from '@/app/_lib/workspace';
import { getAnalytics } from '@/app/_lib/analytics';
import { analyticsQuerySchema } from '@/modules/analytics/dashboard';
import { PageHeader, Panel, UnavailableState } from '../components';
import { AnalyticsView } from './analytics-view';

export const metadata = { title: 'Métricas · Auto Email' };
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccount();
  const query = analyticsQuerySchema.safeParse(await searchParams);
  const [result] = query.success
    ? await Promise.allSettled([
        getAnalytics().then((access) => access.get(query.data)),
      ])
    : [];
  return (
    <>
      <PageHeader
        title="Cómo evoluciona tu asistente."
        description="Uso observado, correcciones y costes estimados a lo largo del tiempo."
      />
      {!query.success ? (
        <Panel title="Periodo">
          <p className="form-error">El periodo no es válido.</p>
          <Link className="text-link" href="/analytics">
            Ver últimos 30 días
          </Link>
        </Panel>
      ) : result?.status === 'fulfilled' ? (
        <AnalyticsView snapshot={result.value} />
      ) : (
        <Panel title="Métricas">
          <UnavailableState>
            No podemos cargar tus métricas. Vuelve a intentarlo.
          </UnavailableState>
        </Panel>
      )}
    </>
  );
}
