import { describe, expect, it } from 'vitest';
import { getAuthConfig } from './config';

const valid = {
  APP_URL: 'https://mail.example.com',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

describe('configuración de autenticación', () => {
  it('activa cookies Secure para HTTPS y permite desarrollo en loopback', () => {
    expect(getAuthConfig(valid).secureCookies).toBe(true);
    expect(
      getAuthConfig({ ...valid, APP_URL: 'http://localhost:3000' })
        .secureCookies,
    ).toBe(false);
  });

  it.each([
    {},
    { ...valid, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never-expose' },
    { ...valid, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' },
    { ...valid, APP_URL: 'http://public.example.com' },
    { ...valid, APP_URL: 'https://user:password@example.com' },
    { ...valid, APP_URL: 'https://example.com/redirect' },
    { ...valid, SUPABASE_URL: 'https://example.com?token=private' },
  ])(
    'rechaza configuración incompleta o insegura sin incluir valores en el error',
    (env) => {
      expect(() => getAuthConfig(env)).toThrow(
        'Configuración de autenticación incompleta o inválida.',
      );
    },
  );
});
