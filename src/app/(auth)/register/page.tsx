import { redirect } from 'next/navigation';
import { getAccount } from '@/app/_lib/auth';
import { isAuthConfigured } from '@/modules/auth/config';
import { AuthForm } from '../auth-form';

export const metadata = { title: 'Crear cuenta · Auto Email' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const result = await getAccount();
  if (result.status === 'authenticated') redirect('/app');
  const configured = isAuthConfigured();

  return (
    <>
      <h1>Tu espacio empieza aquí</h1>
      <p className="description">
        Crea tu cuenta de Auto Email. Conectar Gmail será un paso independiente.
      </p>
      {!configured && (
        <p role="alert" className="form-error">
          El registro no está disponible en este momento.
        </p>
      )}
      <AuthForm registering disabled={!configured} />
    </>
  );
}
