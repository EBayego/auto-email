import { telemetryContext } from '@/modules/observability/context';

const eventTypes = new Set([
  'SYNC_COMPLETED',
  'SYNC_FAILED',
  'SYNC_CYCLE_FAILED',
  'JOB_PROCESSED',
  'JOB_PROCESSING_FAILED',
  'JOB_CYCLE_COMPLETED',
  'JOB_CYCLE_FAILED',
  'DRAFT_RECONCILED',
  'DRAFT_RECONCILIATION_FAILED',
  'PROVIDER_RETRY',
  'PROVIDER_WAIT',
  'PROVIDER_FAILED',
  'ONBOARDING_COMPLETED',
  'ONBOARDING_FAILED',
  'SENT_DRAFT_CHECKED',
  'SENT_DRAFT_CHECK_FAILED',
  'REPLY_COMPARISON_COMPLETED',
  'REPLY_COMPARISON_FAILED',
  'ACCOUNT_DELETION_COMPLETED',
  'ACCOUNT_DELETION_RETRY',
  'WORKER_CYCLE_COMPLETED',
  'SECURITY_CONTAINED',
  'SECURITY_RESTORE_COMPLETED',
  'SECURITY_MAINTENANCE_FAILED',
]);
const codes = new Set([
  'OTHER',
  'UNAVAILABLE',
  'FORBIDDEN',
  'NOT_CONNECTED',
  'PAUSED',
  'REAUTH_REQUIRED',
  'AUTHENTICATION_FAILED',
  'INVALID_GRANT',
  'ACCESS_TOKEN_REJECTED',
  'RATE_LIMITED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'REQUEST_REJECTED',
  'INVALID_RESPONSE',
  'QUOTA_EXCEEDED',
  'QUOTA_WAIT_EXHAUSTED',
  'CANCELLED',
  'LEASE_LOST',
  'TRACKING_RESULT_SAVED',
  'TRACKING_LEASE_LOST',
  'ORIGINAL_UNAVAILABLE',
  'SENT_UNAVAILABLE',
  'ALREADY_ANSWERED',
  'EXCLUDED_DOMAIN',
  'NO_REPLY',
  'STYLE_PROFILE_REQUIRED',
  'DATABASE_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'AUTH_UNAVAILABLE',
]);
const reasons = new Set(codes);
for (const prefix of ['', 'SYNC_', 'JOB_', 'SYNC_GOOGLE_', 'SYNC_OPENAI_'])
  for (const code of codes)
    for (const suffix of ['', '_ATTEMPTS', '_TIME', '_UNSAFE'])
      reasons.add(`${prefix}${code}${suffix}`);
const counts = [
  'attempt',
  'delayMs',
  'claimed',
  'classified',
  'skipped',
  'awaitingGeneration',
  'reviewRequired',
  'draftsCreated',
  'failed',
  'recovered',
  'messagesDetected',
  'scanned',
  'selected',
  'completed',
];

// An allowlist, not regex replacement over arbitrary objects or error messages.
export function safeOperationalEvent(value: unknown) {
  const raw =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const safe: Record<string, string | number | boolean> = {
    type:
      typeof raw.type === 'string' && eventTypes.has(raw.type)
        ? raw.type
        : 'UNKNOWN_EVENT',
  };
  for (const key of counts)
    if (
      typeof raw[key] === 'number' &&
      Number.isSafeInteger(raw[key]) &&
      raw[key] >= 0 &&
      raw[key] <= 1e12
    )
      safe[key] = raw[key];
  if (typeof raw.failed === 'boolean') safe.failed = raw.failed;
  for (const key of ['reasonCode', 'errorCode'])
    if (typeof raw[key] === 'string')
      safe[key] = reasons.has(raw[key]) ? raw[key] : 'OTHER';
  if (raw.provider === 'google' || raw.provider === 'openai')
    safe.provider = raw.provider;
  return safe;
}
export function logOperationalEvent(value: unknown) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...telemetryContext(),
      ...safeOperationalEvent(value),
    }),
  );
}
