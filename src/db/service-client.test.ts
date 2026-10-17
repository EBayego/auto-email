import { describe, expect, it, vi } from 'vitest';
import { readServerConfig } from '@/config/env';
import { createServiceDataClient } from './service-client';

describe('cliente privilegiado de Supabase', () => {
  it('utiliza exclusivamente la clave de servidor y desactiva la persistencia de sesión', async () => {
    const config = readServerConfig({
      APP_ENV: 'test',
      PROVIDER_MODE: 'mock',
      APP_URL: 'http://localhost:3000',
      SUPABASE_URL: 'http://127.0.0.1:55321',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit',
      SUPABASE_SECRET_KEY: 'sb_secret_private_unit',
      PROVIDER_TIMEOUT_MS: '30000',
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    const client = createServiceDataClient(config, fetcher);
    await client
      .from('users')
      .select('id')
      .eq('id', '00000000-0000-4000-8000-000000000081');
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('apikey')).toBe('sb_secret_private_unit');
    expect(fetcher.mock.calls[0][1]?.cache).toBe('no-store');
    expect((await client.auth.getSession()).data.session).toBeNull();
  });
});
