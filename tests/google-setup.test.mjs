import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readServerConfig } from '../src/config/env';
import {
  checkGoogleCredentials,
  GoogleSetupError,
  runGoogleCheck,
} from '../scripts/check-google.mjs';

const environment = {
  APP_ENV: 'development',
  PROVIDER_MODE: 'live',
  APP_URL: 'http://localhost:3000',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit',
  SUPABASE_SECRET_KEY: 'sb_secret_unit_private',
  OPENAI_API_KEY: 'sk-unit-private',
  OPENAI_MODEL: 'unit-model',
  OPENAI_REASONING_EFFORT: 'omit',
  OPENAI_MAX_OUTPUT_TOKENS: '2048',
  GOOGLE_CLIENT_ID: 'unit.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'unit-google-secret-private',
  GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/gmail/callback',
  PROVIDER_TIMEOUT_MS: '30000',
};
const config = readServerConfig(environment);
const web = {
  project_id: 'auto-email-511915',
  client_id: environment.GOOGLE_CLIENT_ID,
  client_secret: environment.GOOGLE_CLIENT_SECRET,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  redirect_uris: [environment.GOOGLE_REDIRECT_URI],
};

function check(value) {
  return checkGoogleCredentials(config, JSON.stringify(value));
}

describe('configuración de Google Cloud (MAIL-011)', () => {
  it('contrasta el cliente web exportado con el proyecto y el servidor sin devolver secretos', () => {
    const report = check({ web });
    expect(report.projectId).toBe('auto-email-511915');
    expect(report.redirectUri).toBe(environment.GOOGLE_REDIRECT_URI);
    expect(report.scopes).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ]);
    expect(report.consoleUrls.gmailApi).toBe(
      'https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=auto-email-511915',
    );
    for (const value of Object.values(report.consoleUrls))
      expect(new URL(value).searchParams.get('project')).toBe(report.projectId);
    expect(JSON.stringify(report)).not.toContain(web.client_secret);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { installed: web },
    { type: 'service_account', private_key: 'private' },
    { web: [] },
    { web, installed: web },
  ])(
    'rechaza credenciales que no sean exclusivamente de un cliente web',
    (value) => {
      expect(() => check(value)).toThrow('Web application');
    },
  );

  it.each([
    { project_id: undefined },
    { project_id: 'private-project?secret=value' },
    { project_id: 'another-project' },
    { auth_uri: 'https://attacker.example/auth' },
    { token_uri: 'https://attacker.example/token' },
    { client_id: 'another.apps.googleusercontent.com' },
    { client_secret: 'different-private-client-secret' },
    { client_secret: undefined },
    { redirect_uris: undefined },
    { redirect_uris: environment.GOOGLE_REDIRECT_URI },
    { redirect_uris: ['http://127.0.0.1:3000/api/gmail/callback'] },
    { redirect_uris: ['http://localhost:3001/api/gmail/callback'] },
    { redirect_uris: ['http://localhost:3000/api/gmail/callback/'] },
    { redirect_uris: ['http://localhost:3000/auth/callback'] },
    { redirect_uris: ['http://localhost:3000/api/gmail/callback?extra=1'] },
  ])(
    'detecta proyecto, endpoints, credenciales o redirecciones incorrectos',
    (override) => {
      expect(() => check({ web: { ...web, ...override } })).toThrow(
        GoogleSetupError,
      );
    },
  );

  it('identifica las variables que difieren sin incluir sus valores', () => {
    try {
      check({
        web: {
          ...web,
          client_id: 'another.apps.googleusercontent.com',
          client_secret: 'different-private-client-secret',
          redirect_uris: [],
        },
      });
      expect.fail('Debe rechazar la configuración');
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleSetupError);
      for (const name of [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI',
      ])
        expect(error.message).toContain(name);
      expect(String(error)).not.toContain(web.client_secret);
      expect(String(error)).not.toContain('different-private-client-secret');
    }
  });

  it('acepta un callback entre varios y el endpoint de autorización v2', () => {
    expect(
      check({
        web: {
          ...web,
          auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth',
          redirect_uris: [
            'http://localhost:3001/api/gmail/callback',
            environment.GOOGLE_REDIRECT_URI,
          ],
        },
      }).redirectUri,
    ).toBe(environment.GOOGLE_REDIRECT_URI);
  });

  it('rechaza mocks y un JSON malformado sin propagar fragmentos privados del parser', () => {
    expect(() =>
      checkGoogleCredentials({ providerMode: 'mock' }, JSON.stringify({ web })),
    ).toThrow('PROVIDER_MODE=live');
    try {
      checkGoogleCredentials(config, `{"private":"${web.client_secret}`);
      expect.fail('Debe rechazar el JSON');
    } catch (error) {
      expect(error.message).toContain('JSON válido');
      expect(String(error)).not.toContain(web.client_secret);
    }
  });

  it('ofrece ayuda sin leer credenciales y rechaza argumentos inesperados', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runGoogleCheck(['--help']);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('No realiza peticiones'),
    );
    expect(() => runGoogleCheck([])).toThrow('--credentials');
    expect(() => runGoogleCheck(['--unknown=private'])).toThrow(
      GoogleSetupError,
    );
    expect(() => runGoogleCheck(['--credentials'])).toThrow(GoogleSetupError);
  });

  it('el comando contrasta un archivo real, falla de forma segura y no lo modifica', () => {
    const directory = mkdtempSync(join(tmpdir(), 'auto-email-google-'));
    const credentialsPath = join(directory, 'client_secret.json');
    const contents = JSON.stringify({ web });
    writeFileSync(credentialsPath, contents, { mode: 0o600 });
    const run = () =>
      spawnSync(
        process.execPath,
        ['scripts/check-google.mjs', '--credentials', credentialsPath],
        {
          encoding: 'utf8',
          env: { ...process.env, ...environment },
          timeout: 10000,
          windowsHide: true,
        },
      );
    try {
      const success = run();
      expect(success.status).toBe(0);
      expect(success.stdout).toContain('auto-email-511915');
      expect(success.stdout).toContain('no autentica el cliente');
      expect(success.stdout).toContain('pendientes en Google Cloud');
      expect(success.stdout + success.stderr).not.toContain(web.client_secret);
      expect(readFileSync(credentialsPath, 'utf8')).toBe(contents);

      writeFileSync(credentialsPath, `{"private":"${web.client_secret}`);
      const failure = run();
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain('JSON válido');
      expect(failure.stdout + failure.stderr).not.toContain(web.client_secret);

      rmSync(credentialsPath);
      const missing = run();
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('No se pudo leer');
    } finally {
      rmSync(credentialsPath, { force: true });
      rmdirSync(directory);
    }
  });
});
