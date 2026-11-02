import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { testProcessEnvironment } from '../scripts/test-environment.mjs';
import {
  testNetworkOrigins,
  testFetch,
  testSocketAllowed,
} from './setup/network-policy.mjs';
const env = {
  APP_ENV: 'test',
  PROVIDER_MODE: 'mock',
  AUTO_EMAIL_TEST_NETWORK_MODE: 'integration',
  AUTO_EMAIL_TEST_URL: 'http://127.0.0.1:55321',
  AUTO_EMAIL_TEST_APP_URL: 'http://127.0.0.1:45000',
};
describe('MAIL-064 límites de red de las pruebas', () => {
  it.each([
    { APP_ENV: 'production' },
    { PROVIDER_MODE: 'live' },
    { AUTO_EMAIL_TEST_NETWORK_MODE: '' },
    { AUTO_EMAIL_TEST_URL: 'https://127.0.0.1:55321' },
    { AUTO_EMAIL_TEST_URL: 'http://example.invalid:55321' },
    { AUTO_EMAIL_TEST_URL: 'http://127.0.0.1' },
    { AUTO_EMAIL_TEST_URL: 'http://user:secret@127.0.0.1:55321' },
    { AUTO_EMAIL_TEST_APP_URL: 'http://127.0.0.1:45000/path' },
    { AUTO_EMAIL_TEST_APP_URL: 'http://127.0.0.1:45000/?secret=1' },
  ])('cierra el arranque ante una configuración insegura: %j', (override) => {
    expect(() => testNetworkOrigins({ ...env, ...override })).toThrow();
  });
  it('permite solo los dos orígenes explícitos de integración y ninguno en las unitarias', async () => {
    const origins = testNetworkOrigins(env),
      fetcher = vi.fn(async () => new Response('local'));
    expect(
      testNetworkOrigins({ ...env, AUTO_EMAIL_TEST_NETWORK_MODE: 'unit' }),
    ).toEqual([]);
    const guarded = testFetch(origins, fetcher);
    await guarded(
      new Request(`${origins[0]}/rest/v1/users`, { redirect: 'follow' }),
    );
    expect(fetcher).toHaveBeenLastCalledWith(expect.any(Request), {
      redirect: 'error',
    });
    await guarded(`${origins[1]}/login`, { redirect: 'manual' });
    expect(fetcher).toHaveBeenLastCalledWith(`${origins[1]}/login`, {
      redirect: 'manual',
    });
    for (const url of [
      'http://127.0.0.1:45001/',
      'https://127.0.0.1:45000/',
      'http://127.0.0.1.example.invalid:45000/',
      'https://provider.example.invalid/',
    ])
      await expect(guarded(url)).rejects.toThrow('TEST_NETWORK_BLOCKED');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('valida el destino TCP real, también en argumentos normalizados y sin aceptar pipes', () => {
    const origins = testNetworkOrigins(env);
    for (const args of [
      [55321, '127.0.0.1'],
      [{ host: '127.0.0.1', port: 45000 }],
      [[{ host: '127.0.0.1', port: 55321 }]],
    ])
      expect(testSocketAllowed(origins, args)).toBe(true);
    for (const args of [
      [443, '203.0.113.1'],
      [45001, '127.0.0.1'],
      [{ host: 'provider.example.invalid', port: 55321 }],
      [{ path: '/tmp/provider.sock' }],
      ['\\\\remote\\pipe\\provider'],
      [],
    ])
      expect(testSocketAllowed(origins, args)).toBe(false);
  });
  it.each([
    "await fetch('https://provider.example.invalid/secret?token=synthetic')",
    "await fetch('http://127.0.0.1:55321/rest/v1/users')",
    "await new Promise((resolve,reject)=>http.get('http://provider.example.invalid/',resolve).once('error',reject))",
    "await new Promise((resolve,reject)=>https.get('https://provider.example.invalid/',resolve).once('error',reject))",
    "net.connect(443,'203.0.113.1')",
    "new net.Socket().connect({host:'203.0.113.1',port:443})",
    "tls.connect({host:'203.0.113.1',port:443})",
  ])('el preload bloquea antes de abrir la conexión: %s', (operation) => {
    const script = `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls'; try { ${operation}; process.exitCode=1; } catch(error) { if(error.message!=='TEST_NETWORK_BLOCKED') process.exitCode=1; else console.log('BLOCKED'); }`;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        env: testProcessEnvironment({ AUTO_EMAIL_TEST_NETWORK_MODE: 'unit' }),
      },
    );
    expect(output.trim()).toBe('BLOCKED');
  });
  it('el entorno de pruebas elimina credenciales heredadas y permite únicamente las claves locales explícitas', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-private-must-not-reach-tests');
    vi.stubEnv('GMAIL_TOKEN_ENCRYPTION_KEY', 'private-key');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_private');
    const child = testProcessEnvironment({
      SUPABASE_SECRET_KEY: 'sb_secret_local_synthetic',
    });
    expect(child.OPENAI_API_KEY).toBe('');
    expect(child.GMAIL_TOKEN_ENCRYPTION_KEY).toBe('');
    expect(child.SUPABASE_SECRET_KEY).toBe('sb_secret_local_synthetic');
    expect(child.NODE_OPTIONS).toContain('network-guard.mjs');
  });
});
