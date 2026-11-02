import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { readServerConfig, ConfigurationError } from '../src/config/env';
import { readPrivacyNotice } from '../src/modules/privacy/config';
import { getErasureLedger } from '../src/modules/security/erasure-ledger';
import { readGenerationPricing } from '../src/modules/analytics/generations';
import { readObservabilityConfig } from '../src/modules/observability/config';
import { readSharePointConfig } from '../src/config/sharepoint';

export async function productionReadiness(
  env: Record<string, string | undefined> = process.env,
) {
  const pending: string[] = [];
  try {
    readSharePointConfig(env);
  } catch (error) {
    pending.push(
      ...(error instanceof ConfigurationError
        ? error.variables
        : ['SHAREPOINT_CONFIGURATION']),
    );
  }
  try {
    const config = readServerConfig(env);
    if (!['production', 'staging'].includes(config.environment))
      pending.push('APP_ENV');
  } catch (error) {
    pending.push(
      ...(error instanceof ConfigurationError
        ? error.variables
        : ['SERVER_CONFIGURATION']),
    );
  }
  if (!readPrivacyNotice(env).ready)
    pending.push('PRIVACY_CONFIGURATION_AND_REVIEW');
  try {
    if (
      new URL(env.SUPABASE_URL ?? '').origin !==
      'https://zbcexekelujsqkkynsog.supabase.co'
    )
      pending.push('SUPABASE_SHARED_PROJECT');
  } catch {
    pending.push('SUPABASE_SHARED_PROJECT');
  }
  try {
    if (!readGenerationPricing(env)) pending.push('OPENAI_PRICING');
  } catch {
    pending.push('OPENAI_PRICING');
  }
  try {
    const webhook = readObservabilityConfig(env).webhook;
    if (
      !webhook ||
      /(?:^|\.)(?:invalid|test|example|local)$/.test(
        new URL(webhook.reveal()).hostname,
      ) ||
      /(?:^|\.)example\.(?:com|net|org)$/.test(
        new URL(webhook.reveal()).hostname,
      )
    )
      pending.push('ALERT_WEBHOOK_URL');
  } catch {
    pending.push('OBSERVABILITY_CONFIGURATION');
  }
  if (env.SECURITY_MAINTENANCE_MODE === 'true')
    pending.push('SECURITY_MAINTENANCE_MODE');
  try {
    const ledger = getErasureLedger(env);
    if (!ledger) throw new Error();
    await ledger.verify();
  } catch {
    pending.push('PERSISTENT_ERASURE_LEDGER');
  }
  return { ready: pending.length === 0, pending: [...new Set(pending)].sort() };
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(
      'Uso: npm run production:check\nValida configuración, privacidad, precios, alertas y registro persistente. No despliega ni modifica datos.',
    );
    return;
  }
  nextEnvironment.loadEnvConfig(process.cwd(), false, {
    info() {},
    error() {},
  });
  const result = await productionReadiness();
  console.log(JSON.stringify({ type: 'PRODUCTION_READINESS', ...result }));
  if (!result.ready) process.exitCode = 1;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error('PRODUCTION_CHECK_FAILED');
    process.exitCode = 1;
  });
