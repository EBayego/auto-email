import { describe, expect, it } from 'vitest';
import { readServerConfig, readWebServerConfig } from './env';
const web = {
  APP_ENV: 'development',
  PROVIDER_MODE: 'live',
  APP_URL: 'http://localhost:3000',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  PROVIDER_TIMEOUT_MS: '30000',
  GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-google-secret-private',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/gmail/callback',
  GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 62).toString('base64'),
};
describe('MAIL-062 capacidades y secretos por proceso', () => {
  it('el servidor web valida Gmail y Supabase sin cargar ni requerir una clave de OpenAI', () => {
    const config = readWebServerConfig({
      ...web,
      OPENAI_API_KEY: 'sk-must-not-load',
    });
    expect(config.providerMode).toBe('live');
    expect(Object.hasOwn(config, 'openai')).toBe(false);
    expect(() => readWebServerConfig(web)).not.toThrow();
    expect(() => readServerConfig(web)).toThrow('OPENAI_API_KEY');
  });
  it('sigue rechazando claves expuestas al navegador y transporte HTTP fuera del equipo local', () => {
    expect(() =>
      readWebServerConfig({ ...web, SECURITY_MAINTENANCE_MODE: 'treu' }),
    ).toThrow('SECURITY_MAINTENANCE_MODE');
    expect(() =>
      readWebServerConfig({
        ...web,
        NEXT_PUBLIC_ERASURE_LEDGER_ENCRYPTION_KEY: 'private-key',
      }),
    ).toThrow('NEXT_PUBLIC_ERASURE_LEDGER_ENCRYPTION_KEY');
    expect(() =>
      readWebServerConfig({ ...web, APP_ENV: 'production' }),
    ).toThrow();
  });
});
