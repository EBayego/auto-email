import { inspect } from 'node:util';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ConfigurationError, readServerConfig, SecretValue } from './env';

const valid = {
  APP_ENV: 'development',
  PROVIDER_MODE: 'live',
  APP_URL: 'http://localhost:3000',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit',
  SUPABASE_SECRET_KEY: 'sb_secret_unit_private',
  OPENAI_API_KEY: 'sk-unit-private',
  OPENAI_MODEL: 'gpt-6-luna',
  OPENAI_REASONING_EFFORT: 'none',
  OPENAI_MAX_OUTPUT_TOKENS: '2048',
  GOOGLE_CLIENT_ID: 'unit.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'unit-google-secret-private',
  GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/gmail/callback',
  PROVIDER_TIMEOUT_MS: '30000',
};

describe('configuración y secretos', () => {
  it('valida los proveedores sin fijar credenciales ni modelo en la lógica', () => {
    const config = readServerConfig({
      ...valid,
      OPENAI_MODEL: 'another-model',
      OPENAI_REASONING_EFFORT: 'omit',
    });
    expect(config.providerMode).toBe('live');
    expect(config.openai?.model).toBe('another-model');
    expect(config.supabase.secretKey.reveal()).toBe(valid.SUPABASE_SECRET_KEY);
  });

  it('redacta secretos en JSON, cadenas e inspección de logs', () => {
    const config = readServerConfig(valid);
    const output =
      JSON.stringify(config) +
      inspect(config, { depth: 10 }) +
      String(new SecretValue('private-token'));
    for (const value of [
      valid.SUPABASE_SECRET_KEY,
      valid.OPENAI_API_KEY,
      valid.GOOGLE_CLIENT_SECRET,
      valid.GMAIL_TOKEN_ENCRYPTION_KEY,
      'private-token',
    ])
      expect(output).not.toContain(value);
    expect(output).toContain('[REDACTED]');
  });

  it.each([
    'APP_ENV',
    'PROVIDER_MODE',
    'SUPABASE_SECRET_KEY',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'OPENAI_REASONING_EFFORT',
    'OPENAI_MAX_OUTPUT_TOKENS',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GMAIL_TOKEN_ENCRYPTION_KEY',
    'GOOGLE_REDIRECT_URI',
    'PROVIDER_TIMEOUT_MS',
  ])('rechaza %s ausente sin imprimir valores', (name) => {
    try {
      readServerConfig({ ...valid, [name]: '' });
      throw new Error('Debe fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).variables).toContain(name);
      expect(String(error)).not.toContain(valid.OPENAI_API_KEY);
    }
  });

  it.each([
    { APP_ENV: 'production', APP_URL: 'http://localhost:3000' },
    { APP_ENV: 'staging', SUPABASE_URL: 'http://127.0.0.1:55321' },
    { APP_ENV: 'production', PROVIDER_MODE: 'mock' },
    { APP_ENV: 'test', PROVIDER_MODE: 'live' },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never-public' },
    { SUPABASE_SECRET_KEY: 'sb_publishable_not-privileged' },
    { GOOGLE_REDIRECT_URI: 'https://attacker.example/api/gmail/callback' },
    {
      GOOGLE_REDIRECT_URI:
        'http://localhost:3000/api/gmail/callback?secret=private',
    },
    { NEXT_PUBLIC_OPENAI_API_KEY: 'private' },
    { EXPO_PUBLIC_GOOGLE_CLIENT_SECRET: 'private' },
    { NEXT_PUBLIC_GMAIL_TOKEN_ENCRYPTION_KEY: 'private' },
    { GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') },
    { PROVIDER_TIMEOUT_MS: '999999' },
    { OPENAI_MAX_OUTPUT_TOKENS: '-1' },
  ])('rechaza combinaciones inseguras de entorno', (override) => {
    expect(() => readServerConfig({ ...valid, ...override })).toThrow(
      ConfigurationError,
    );
  });

  it('acepta staging y producción con HTTPS y proveedores reales', () => {
    for (const APP_ENV of ['staging', 'production'])
      expect(
        readServerConfig({
          ...valid,
          APP_ENV,
          APP_URL: 'https://mail.example.com',
          GOOGLE_REDIRECT_URI: 'https://mail.example.com/api/gmail/callback',
        }).environment,
      ).toBe(APP_ENV);
  });

  it('el modo de pruebas permite prescindir de claves externas y exige Supabase local', () => {
    const mock = {
      ...valid,
      APP_ENV: 'test',
      PROVIDER_MODE: 'mock',
      SUPABASE_URL: 'http://127.0.0.1:55321',
      OPENAI_API_KEY: '',
      GOOGLE_CLIENT_SECRET: '',
    };
    expect(readServerConfig(mock).openai).toBeNull();
    expect(() =>
      readServerConfig({ ...mock, SUPABASE_URL: valid.SUPABASE_URL }),
    ).toThrow(ConfigurationError);
  });

  it('el arranque npm falla antes de levantar Next.js si faltan credenciales', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/run-next.mjs', 'start'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...valid,
          SUPABASE_SECRET_KEY: '',
          GOOGLE_CLIENT_SECRET: '',
        },
        timeout: 10000,
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SUPABASE_SECRET_KEY');
    expect(result.stderr).not.toContain(valid.OPENAI_API_KEY);
    expect(result.stdout).not.toContain('Ready');
  });
});
