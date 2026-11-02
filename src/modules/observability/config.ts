import { ConfigurationError, SecretValue } from '../../config/env.ts';

export function readObservabilityConfig(
  env: Record<string, string | undefined> = process.env,
) {
  function integer(name: string, fallback: number, min: number, max: number) {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      throw new ConfigurationError([name]);
    return value;
  }
  const raw = env.ALERT_WEBHOOK_URL;
  let webhook: SecretValue | null = null;
  if (raw) {
    try {
      const url = new URL(raw);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      )
        throw new Error();
      webhook = new SecretValue(url.href);
    } catch {
      throw new ConfigurationError(['ALERT_WEBHOOK_URL']);
    }
  }
  const secret = env.ALERT_WEBHOOK_BEARER_TOKEN;
  if (
    secret &&
    (!webhook || /[\s\p{Cc}]/u.test(secret) || secret.length > 4096)
  )
    throw new ConfigurationError(['ALERT_WEBHOOK_BEARER_TOKEN']);
  return {
    webhook,
    bearer: secret ? new SecretValue(secret) : null,
    windowSeconds: integer('OBSERVABILITY_WINDOW_SECONDS', 900, 60, 86400),
    staleSeconds: integer('OBSERVABILITY_STALE_SECONDS', 900, 120, 86400),
    repeatedErrors: integer('OBSERVABILITY_REPEATED_ERRORS', 3, 2, 1000),
    retentionDays: integer('OBSERVABILITY_RETENTION_DAYS', 14, 7, 90),
    intervalSeconds: integer(
      'OBSERVABILITY_MONITOR_INTERVAL_SECONDS',
      60,
      10,
      3600,
    ),
    webhookTimeoutMs: integer('ALERT_WEBHOOK_TIMEOUT_MS', 5000, 100, 10000),
  };
}
