import { redirect } from 'next/navigation';
import { getAccount } from '@/app/_lib/auth';
import { isAuthConfigured } from '@/modules/auth/config';
import { AuthForm } from '../auth-form';
import { signOut } from '../actions';

export const metadata = { title: 'Iniciar sesión · Auto Email' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const result = await getAccount();
  if (result.status === 'authenticated') redirect('/app');
  const configured = isAuthConfigured();
  const { error } = await searchParams;

  return (
    <>
      <h1>Vuelve a tu espacio</h1>
      <p className="description">Accede a tu cuenta de Auto Email.</p>
      {!configured && (
        <p role="alert" className="form-error">
          El acceso no está disponible en este momento.
        </p>
      )}
      {error === 'confirmation' && (
        <p role="alert" className="form-error">
          El enlace de confirmación no es válido o ha caducado. Si ya
          confirmaste tu correo, inicia sesión.
        </p>
      )}
      {error === 'gmail_session' && (
        <p role="alert" className="form-error">
          Tu sesión ha cambiado o ha caducado. Inicia sesión y vuelve a conectar
          Gmail.
        </p>
      )}
      {result.status === 'forbidden' ? (
        <>
          <p role="alert" className="form-error">
            Esta cuenta no tiene acceso a la aplicación.
          </p>
          <form action={signOut}>
            <button className="button" type="submit">
              Cerrar sesión
            </button>
          </form>
        </>
      ) : (
        <AuthForm registering={false} disabled={!configured} />
      )}
    </>
  );
}
