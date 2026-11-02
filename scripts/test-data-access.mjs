import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { testProcessEnvironment } from './test-environment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const e2e = process.argv[2] === '--e2e';
const privacyEnvironment = JSON.parse(
  readFileSync(
    new URL('../tests/fixtures/privacy-env.json', import.meta.url),
    'utf8',
  ),
);
const securityEnvironment = {
  ERASURE_LEDGER_DIRECTORY: path.join(
    root,
    '.cache',
    `integration-erasures-${randomUUID()}`,
  ),
  ERASURE_LEDGER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SECURITY_MAINTENANCE_MODE: 'false',
};
const initialized = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    'scripts/security-maintenance.ts',
    '--action',
    'init',
    '--confirmed',
  ],
  {
    cwd: root,
    env: { ...process.env, APP_ENV: 'test', ...securityEnvironment },
    encoding: 'utf8',
    windowsHide: true,
  },
);
if (initialized.status !== 0)
  throw new Error(
    'No se pudo inicializar el registro de supresiones de pruebas.',
  );
const cli = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
    ),
    'status',
    '--output',
    'json',
  ],
  {
    cwd: root,
    env: { ...process.env, DO_NOT_TRACK: '1' },
    windowsHide: true,
    encoding: 'utf8',
  },
);

if (cli.status !== 0)
  throw new Error('La base local auto-email debe estar arrancada.');
const config = JSON.parse(cli.stdout);
const url = new URL(config.API_URL);
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '55321' ||
  !config.PUBLISHABLE_KEY ||
  !config.SECRET_KEY
) {
  throw new Error(
    'Las pruebas solo pueden usar la base temporal local auto-email.',
  );
}

const listener = createServer();
await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', resolve);
});
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL('../node_modules/next/dist/bin/next', import.meta.url),
    ),
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    cwd: root,
    env: testProcessEnvironment({
      AUTO_EMAIL_TEST_NETWORK_MODE: 'integration',
      AUTO_EMAIL_TEST_URL: url.origin,
      AUTO_EMAIL_TEST_APP_URL: origin,
      APP_ENV: 'test',
      ...privacyEnvironment,
      ...securityEnvironment,
      PROVIDER_MODE: 'mock',
      SUPABASE_SECRET_KEY: config.SECRET_KEY,
      PROVIDER_TIMEOUT_MS: '30000',
      APP_URL: origin,
      SUPABASE_URL: url.origin,
      SUPABASE_PUBLISHABLE_KEY: config.PUBLISHABLE_KEY,
      OPENAI_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      NEXT_TELEMETRY_DISABLED: '1',
    }),
    stdio: 'ignore',
    windowsHide: true,
  },
);

try {
  let ready = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      ready = (await fetch(`${origin}/login`)).ok;
    } catch {
      /* Servidor en arranque. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready)
    throw new Error(
      'No se pudo arrancar el build de Next.js para las pruebas.',
    );
  const runner = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          e2e
            ? '../node_modules/@playwright/test/cli.js'
            : '../node_modules/vitest/vitest.mjs',
          import.meta.url,
        ),
      ),
      e2e ? 'test' : 'run',
      '--config',
      e2e ? 'playwright.config.ts' : 'vitest.integration.config.mts',
      ...process.argv.slice(e2e ? 3 : 2),
    ],
    {
      cwd: root,
      env: testProcessEnvironment({
        AUTO_EMAIL_TEST_NETWORK_MODE: 'integration',
        ...(e2e
          ? {
              WORKER_GMAIL_REQUESTS_PER_MINUTE: '10000',
              WORKER_GMAIL_ACCOUNT_REQUESTS_PER_MINUTE: '1000',
              WORKER_OPENAI_REQUESTS_PER_MINUTE: '10000',
              WORKER_OPENAI_ACCOUNT_REQUESTS_PER_MINUTE: '1000',
              WORKER_PROVIDER_BASE_DELAY_MS: '100',
              WORKER_PROVIDER_MAX_DELAY_MS: '100',
            }
          : {}),
        APP_ENV: 'test',
        ...privacyEnvironment,
        ...securityEnvironment,
        PROVIDER_MODE: 'mock',
        APP_URL: origin,
        SUPABASE_URL: url.origin,
        SUPABASE_PUBLISHABLE_KEY: config.PUBLISHABLE_KEY,
        SUPABASE_SECRET_KEY: config.SECRET_KEY,
        PROVIDER_TIMEOUT_MS: '30000',
        OPENAI_API_KEY: '',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        AUTO_EMAIL_TEST_URL: url.origin,
        AUTO_EMAIL_TEST_PUBLISHABLE_KEY: config.PUBLISHABLE_KEY,
        AUTO_EMAIL_TEST_SECRET_KEY: config.SECRET_KEY,
        AUTO_EMAIL_TEST_APP_URL: origin,
      }),
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    runner.once('error', reject);
    runner.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  server.kill();
}
