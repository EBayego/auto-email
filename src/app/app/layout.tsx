import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getAccount } from '@/app/_lib/auth';

export default async function PrivateLayout({
  children,
}: {
  children: ReactNode;
}) {
  const result = await getAccount();
  if (result.status === 'unauthenticated' || result.status === 'forbidden')
    redirect('/login');
  if (result.status === 'unavailable') {
    return (
      <main className="account-shell">
        <p className="form-error" role="alert">
          No podemos cargar tu cuenta en este momento. Vuelve a intentarlo más
          tarde.
        </p>
      </main>
    );
  }
  return children;
}
