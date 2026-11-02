import { createClient } from '@supabase/supabase-js';
import type { DataServiceConfig } from '@/config/env';
import type { Database } from './database.types';

export function createServiceDataClient(
  config: DataServiceConfig,
  fetcher: typeof fetch = fetch,
) {
  return createClient<Database>(
    config.supabase.url,
    config.supabase.secretKey.reveal(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetcher(input, {
            ...init,
            cache: 'no-store',
            redirect: 'error',
            signal: init?.signal ?? AbortSignal.timeout(config.timeoutMs),
          }),
      },
    },
  );
}
