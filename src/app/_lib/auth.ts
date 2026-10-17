import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createAuthClient } from '@/modules/auth/client';
import { resolveAccount, type AccountResult } from '@/modules/auth/session';

export async function createServerAuthClient(writable = false) {
  const cookieStore = await cookies();

  return createAuthClient({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      // Proxy renueva las cookies antes de renderizar los Server Components.
      if (!writable) return;
      for (const { name, value, options } of cookiesToSet) {
        cookieStore.set(name, value, options);
      }
    },
  });
}

export const getAccount = cache(async (): Promise<AccountResult> => {
  try {
    return await resolveAccount(await createServerAuthClient());
  } catch {
    return { status: 'unavailable' };
  }
});
