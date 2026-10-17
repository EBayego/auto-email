'use server';

import { redirect } from 'next/navigation';
import { createServerAuthClient } from '@/app/_lib/auth';
import { getAuthConfig } from '@/modules/auth/config';
import {
  readCredentials,
  type AuthFormState,
} from '@/modules/auth/credentials';
import { resolveAccount } from '@/modules/auth/session';

const unavailable =
  'No se puede acceder en este momento. Inténtalo de nuevo más tarde.';

export async function signIn(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const credentials = readCredentials(formData, false);
  if (!credentials)
    return { error: 'Introduce un correo y una contraseña válidos.' };

  try {
    const client = await createServerAuthClient(true);
    const { error } = await client.auth.signInWithPassword(credentials);
    if (error) {
      return {
        error:
          error.status && error.status < 500 && error.status !== 429
            ? 'No se ha podido iniciar sesión. Revisa tus credenciales y confirma tu correo.'
            : unavailable,
      };
    }

    const result = await resolveAccount(client);
    if (result.status !== 'authenticated') {
      await client.auth.signOut({ scope: 'local' });
      return {
        error:
          result.status === 'forbidden'
            ? 'Esta cuenta no tiene acceso a la aplicación.'
            : unavailable,
      };
    }
  } catch {
    return { error: unavailable };
  }

  redirect('/app');
}

export async function signUp(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const credentials = readCredentials(formData, true);
  if (!credentials) {
    return {
      error:
        'Introduce un correo válido y una contraseña de entre 8 y 128 caracteres.',
    };
  }

  let signedIn: boolean;
  try {
    const config = getAuthConfig();
    const client = await createServerAuthClient(true);
    const { data, error } = await client.auth.signUp({
      ...credentials,
      options: { emailRedirectTo: `${config.appOrigin}/auth/callback` },
    });
    if (error)
      return {
        error: 'No se ha podido crear la cuenta. Inténtalo de nuevo más tarde.',
      };
    signedIn = !!data.session;
  } catch {
    return { error: unavailable };
  }

  if (signedIn) redirect('/app');
  return {
    message:
      'Si el correo puede registrarse, recibirás un enlace para confirmar tu cuenta. Ábrelo en este navegador y después inicia sesión.',
  };
}

export async function signOut(): Promise<void> {
  let failed: boolean;
  try {
    const client = await createServerAuthClient(true);
    const { error } = await client.auth.signOut({ scope: 'local' });
    failed = !!error;
  } catch {
    failed = true;
  }

  if (failed) redirect('/app?error=signout');
  redirect('/login');
}
