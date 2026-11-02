import { fileURLToPath } from 'node:url';
const guard = new URL('../tests/setup/network-guard.mjs', import.meta.url).href;
export function testProcessEnvironment(overrides = {}) {
  return {
    ...process.env,
    ...Object.fromEntries(
      [
        'OPENAI_API_KEY',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GMAIL_TOKEN_ENCRYPTION_KEY',
        'SUPABASE_SECRET_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_ACCESS_TOKEN',
        'SUPABASE_DB_PASSWORD',
        'ERASURE_LEDGER_DIRECTORY',
        'ERASURE_LEDGER_ENCRYPTION_KEY',
        'ALERT_WEBHOOK_URL',
        'ALERT_WEBHOOK_BEARER_TOKEN',
        'PGSERVICEFILE',
        'PGSERVICE',
        'PGPASSWORD',
        'PGPASSFILE',
        'DATABASE_URL',
        'RESTIC_REPOSITORY',
        'RESTIC_PASSWORD',
        'RESTIC_PASSWORD_FILE',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AUTO_EMAIL_HEALTH_FILE',
      ].map((name) => [name, '']),
    ),
    APP_ENV: 'test',
    PROVIDER_MODE: 'mock',
    ...overrides,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${guard}`.trim(),
  };
}
export const vitestPath = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
