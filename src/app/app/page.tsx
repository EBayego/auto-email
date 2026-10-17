import { redirect } from 'next/navigation';
import { getAccount } from '@/app/_lib/auth';
import { signOut } from '@/app/(auth)/actions';

export const metadata = { title: 'Tu cuenta · Auto Email' };
export const dynamic = 'force-dynamic';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const result = await getAccount();
  if (result.status === 'unauthenticated' || result.status === 'forbidden')
    redirect('/login');
  const { error } = await searchParams;

  return (
    <main className="account-shell">
      <header className="account-header">
        <span className="brand">Auto Email</span>
        <form action={signOut}>
          <button className="button button-secondary" type="submit">
            Cerrar sesión
          </button>
        </form>
      </header>
      {error === 'signout' && (
        <p className="form-error" role="alert">
          No se ha podido cerrar la sesión. Inténtalo de nuevo.
        </p>
      )}
      {result.status === 'unavailable' ? (
        <p className="form-error" role="alert">
          No podemos cargar tu cuenta en este momento. Vuelve a intentarlo más
          tarde.
        </p>
      ) : (
        <section className="account-content" aria-labelledby="account-title">
          <p className="eyebrow">Tu cuenta</p>
          <h1 id="account-title">Todo empieza contigo.</h1>
          <p className="intro">{result.account.user.email}</p>
          <p className="description">
            Tu cuenta de Auto Email está lista. Podrás conectar Gmail cuando
            esté disponible.
          </p>
          <dl className="settings-list">
            <div>
              <dt>Automatización</dt>
              <dd>
                {result.account.settings.automationEnabled
                  ? 'Activada'
                  : 'Desactivada'}
              </dd>
            </div>
            <div>
              <dt>Intervalo de comprobación</dt>
              <dd>{result.account.settings.pollIntervalSeconds} segundos</dd>
            </div>
            <div>
              <dt>Límite diario de borradores</dt>
              <dd>{result.account.settings.maxDailyDrafts}</dd>
            </div>
          </dl>
          <p className="description">
            La revisión y el envío de tus respuestas siempre estarán en tus
            manos.
          </p>
        </section>
      )}
    </main>
  );
}
