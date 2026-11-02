import { describe, expect, it } from 'vitest';
import { productionReadiness } from '../scripts/production-check';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SecretValue } from '../src/config/env';
import { createErasureLedger } from '../src/modules/security/erasure-ledger';
import privacy from './fixtures/privacy-env.json';
describe('MAIL-067 preparación de producción', () => {
  it('informa de las tareas pendientes sin imprimir valores de secretos', async () => {
    const result = await productionReadiness({
      APP_ENV: 'production',
      OPENAI_API_KEY: 'private-secret',
      PRIVACY_REVIEW_APPROVED: 'false',
      ERASURE_LEDGER_DIRECTORY: '/nonexistent/private',
    });
    expect(result.ready).toBe(false);
    expect(result.pending).toContain('PRIVACY_CONFIGURATION_AND_REVIEW');
    expect(result.pending).toContain('PERSISTENT_ERASURE_LEDGER');
    expect(result.pending).toContain('ALERT_WEBHOOK_URL');
    expect(JSON.stringify(result)).not.toContain('private-secret');
    expect(JSON.stringify(result)).not.toContain('/nonexistent');
  });
  it('solo habilita producción con la configuración y el registro persistente completos', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'auto-email-production-check-'),
    );
    const key = Buffer.alloc(32, 6).toString('base64');
    const env = {
      ...privacy,
      APP_ENV: 'production',
      PROVIDER_MODE: 'live',
      APP_URL: 'https://app.autoemail.es',
      SUPABASE_URL: 'https://zbcexekelujsqkkynsog.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_unit',
      SUPABASE_SECRET_KEY: 'sb_secret_private',
      GOOGLE_CLIENT_ID: 'unit.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'private-google-secret',
      GOOGLE_REDIRECT_URI: 'https://app.autoemail.es/api/gmail/callback',
      GMAIL_TOKEN_ENCRYPTION_KEY: key,
      OPENAI_API_KEY: 'sk-private-unit',
      OPENAI_MODEL: 'unit-model',
      OPENAI_REASONING_EFFORT: 'omit',
      OPENAI_MAX_OUTPUT_TOKENS: '2048',
      OPENAI_INPUT_USD_PER_MILLION: '1',
      OPENAI_OUTPUT_USD_PER_MILLION: '2',
      PROVIDER_TIMEOUT_MS: '30000',
      ERASURE_LEDGER_DIRECTORY: directory,
      ERASURE_LEDGER_ENCRYPTION_KEY: key,
      ALERT_WEBHOOK_URL: 'https://ops.autoemail.es/hooks/unit',
      SECURITY_MAINTENANCE_MODE: 'false',
    };
    try {
      expect((await productionReadiness(env)).pending).toContain(
        'PERSISTENT_ERASURE_LEDGER',
      );
      await createErasureLedger(directory, new SecretValue(key)).initialize();
      expect(await productionReadiness(env)).toEqual({
        ready: true,
        pending: [],
      });
      expect(
        (
          await productionReadiness({
            ...env,
            ALERT_WEBHOOK_URL: 'https://alerts.example.invalid',
          })
        ).pending,
      ).toContain('ALERT_WEBHOOK_URL');
      expect(
        (
          await productionReadiness({
            ...env,
            SUPABASE_URL: 'https://other-project.supabase.co',
          })
        ).pending,
      ).toContain('SUPABASE_SHARED_PROJECT');
      expect(
        (
          await productionReadiness({
            ...env,
            SECURITY_MAINTENANCE_MODE: 'true',
          })
        ).pending,
      ).toContain('SECURITY_MAINTENANCE_MODE');
      expect(
        (
          await productionReadiness({
            ...env,
            ERASURE_LEDGER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString(
              'base64',
            ),
          })
        ).pending,
      ).toContain('PERSISTENT_ERASURE_LEDGER');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
