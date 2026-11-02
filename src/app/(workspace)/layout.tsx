import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getAccount } from '@/app/_lib/auth';
import { signOut } from '@/app/(auth)/actions';
import { WorkspaceNavigation } from './navigation';
import { UnavailableState } from './components';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const result = await getAccount();
  if (result.status === 'unauthenticated' || result.status === 'forbidden')
    redirect('/login');
  if (result.status !== 'authenticated')
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <Link href="/" className="brand">
            Auto Email
          </Link>
          <h1>Cuenta no disponible</h1>
          <UnavailableState>
            No podemos cargar tu cuenta en este momento. Vuelve a intentarlo.
          </UnavailableState>
        </section>
      </main>
    );
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <aside className="workspace-sidebar">
        <Link href="/dashboard" className="brand workspace-brand">
          <span className="brand-mark" aria-hidden="true">
            ae
          </span>
          Auto Email
        </Link>
        <p className="sidebar-label">Tu espacio</p>
        <WorkspaceNavigation />
        <p className="sidebar-note">
          Tu voz en cada respuesta.
          <br />
          La última palabra, siempre tuya.
        </p>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <div className="workspace-identity">
            <span className="sidebar-label">Cuenta de Auto Email</span>
            <span className="account-email">{result.account.user.email}</span>
          </div>
          <form action={signOut}>
            <button className="button button-secondary" type="submit">
              Cerrar sesión
            </button>
          </form>
        </header>
        <main id="main-content" className="workspace-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="workspace-footer">
          Las respuestas se revisan y envían desde Gmail. Auto Email solo
          prepara borradores.{' '}
          <Link href="/privacy">Privacidad y condiciones</Link>
        </footer>
      </div>
    </div>
  );
}
