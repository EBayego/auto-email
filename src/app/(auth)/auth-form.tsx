'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { AuthFormState } from '@/modules/auth/credentials';
import { signIn, signUp } from './actions';

export function AuthForm({
  registering,
  disabled,
}: {
  registering: boolean;
  disabled: boolean;
}) {
  const initialState: AuthFormState = {};
  const [state, action, pending] = useActionState(
    registering ? signUp : signIn,
    initialState,
  );

  return (
    <>
      <form action={action} className="auth-form">
        <label htmlFor="email">Correo electrónico</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          disabled={disabled || pending}
        />
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          required
          minLength={registering ? 8 : undefined}
          maxLength={128}
          disabled={disabled || pending}
          aria-describedby={registering ? 'password-help' : undefined}
        />
        {registering && (
          <p id="password-help" className="field-help">
            Entre 8 y 128 caracteres.
          </p>
        )}
        {state.error && (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        )}
        {state.message && (
          <p className="form-message" role="status">
            {state.message}
          </p>
        )}
        <button className="button" type="submit" disabled={disabled || pending}>
          {pending
            ? 'Un momento…'
            : registering
              ? 'Crear cuenta'
              : 'Iniciar sesión'}
        </button>
      </form>
      <p className="auth-switch">
        {registering ? '¿Ya tienes cuenta? ' : '¿Aún no tienes cuenta? '}
        <Link href={registering ? '/login' : '/register'}>
          {registering ? 'Inicia sesión' : 'Crea una cuenta'}
        </Link>
      </p>
    </>
  );
}
