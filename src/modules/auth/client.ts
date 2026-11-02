import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { Database } from '@/db/database.types';
import { getAuthConfig, type AuthConfig } from './config';
type CookieWriter = NonNullable<CookieMethodsServer['setAll']>;

export function createAuthClient(
  cookies: CookieMethodsServer,
  config: AuthConfig = getAuthConfig(),
) {
  return createServerClient<Database>(
    config.supabaseUrl,
    config.publishableKey,
    {
      cookies: {
        ...cookies,
        // The SSR SDK reapplies its own lifetime when it writes refreshed chunks.
        // Enforce the session policy at the final write boundary as well.
        ...(cookies.setAll
          ? {
              setAll: (
                values: Parameters<CookieWriter>[0],
                headers: Parameters<CookieWriter>[1],
              ) =>
                cookies.setAll!(
                  values.map((cookie) => ({
                    ...cookie,
                    options: {
                      ...cookie.options,
                      httpOnly: true,
                      secure: config.secureCookies,
                      sameSite: 'lax',
                      path: '/',
                      domain: undefined,
                      maxAge: Math.max(
                        0,
                        Math.min(cookie.options.maxAge ?? 7 * 86400, 7 * 86400),
                      ),
                    },
                  })),
                  headers,
                ),
            }
          : {}),
      },
      cookieOptions: {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 86400,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: 'no-store',
            redirect: 'error',
            signal: init?.signal ?? AbortSignal.timeout(30000),
          }),
      },
    },
  );
}

export type AuthClient = ReturnType<typeof createAuthClient>;
