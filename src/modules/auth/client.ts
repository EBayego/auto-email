import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { Database } from '@/db/database.types';
import { getAuthConfig, type AuthConfig } from './config';

export function createAuthClient(
  cookies: CookieMethodsServer,
  config: AuthConfig = getAuthConfig(),
) {
  return createServerClient<Database>(
    config.supabaseUrl,
    config.publishableKey,
    {
      cookies,
      cookieOptions: {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
        path: '/',
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    },
  );
}

export type AuthClient = ReturnType<typeof createAuthClient>;
