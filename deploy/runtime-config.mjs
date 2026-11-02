import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const common = [
  'APP_ENV',
  'PROVIDER_MODE',
  'APP_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'PROVIDER_TIMEOUT_MS',
  'SECURITY_MAINTENANCE_MODE',
];
const privacy = [
  'PRIVACY_OPERATOR_NAME',
  'PRIVACY_CONTACT_EMAIL',
  'PRIVACY_OPERATOR_ADDRESS',
  'PRIVACY_HOSTING_PROVIDER',
  'PRIVACY_PROCESSING_DISCLOSURE',
  'PRIVACY_REVIEW_APPROVED',
];
const gmail = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GMAIL_TOKEN_ENCRYPTION_KEY',
];
const ledger = ['ERASURE_LEDGER_DIRECTORY', 'ERASURE_LEDGER_ENCRYPTION_KEY'];
const sharepoint = [
  'SHAREPOINT_ENABLED',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_TOKEN_ENCRYPTION_KEY',
  'MICROSOFT_ALLOWED_TENANTS',
  'MICROSOFT_GRAPH_SCOPE',
  'SHAREPOINT_OCR_ENDPOINT',
  'SHAREPOINT_OCR_KEY',
  'SHAREPOINT_OCR_DAILY_PAGE_BUDGET',
];
const prices = [
  'OPENAI_INPUT_USD_PER_MILLION',
  'OPENAI_OUTPUT_USD_PER_MILLION',
];
export function keysFor(role, input) {
  const controls = Object.keys(input).filter((name) =>
    /^WORKER_[A-Z_]+$/.test(name),
  );
  const observations = Object.keys(input).filter((name) =>
    /^OBSERVABILITY_[A-Z_]+$/.test(name),
  );
  const map = {
    web: [...common, ...privacy, ...gmail, ...ledger, ...prices, ...sharepoint],
    worker: [
      ...common,
      ...privacy,
      ...gmail,
      ...sharepoint,
      ...ledger,
      ...prices,
      ...controls,
      ...observations,
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
      'OPENAI_REASONING_EFFORT',
      'OPENAI_MAX_OUTPUT_TOKENS',
    ],
    monitor: [
      ...common,
      ...observations,
      'ALERT_WEBHOOK_URL',
      'ALERT_WEBHOOK_BEARER_TOKEN',
      'ALERT_WEBHOOK_TIMEOUT_MS',
    ],
    backup: [
      ...common,
      'RESTIC_REPOSITORY',
      'RESTIC_PASSWORD_FILE',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_DEFAULT_REGION',
      'BACKUP_RETENTION_DAYS',
      'BACKUP_DIRECTORY',
      'PGSERVICEFILE',
      'PGSERVICE',
      'ERASURE_LEDGER_DIRECTORY',
    ],
    migrate: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'],
  };
  map.preflight = [...new Set([...map.worker, ...map.monitor])];
  if (!map[role]) throw new Error('INVALID_SERVICE_ROLE');
  return map[role];
}
export function selectRuntimeConfig(role, input) {
  if (
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object' ||
    Object.values(input).some((v) => typeof v !== 'string' || v.includes('\0'))
  )
    throw new Error('INVALID_RUNTIME_CONFIG');
  return Object.fromEntries(
    keysFor(role, input)
      .filter((name) => Object.hasOwn(input, name))
      .map((name) => [name, input[name]]),
  );
}
export async function loadRuntimeConfig(role, file) {
  const bytes = await readFile(file, 'utf8');
  if (bytes.length > 65536) throw new Error('INVALID_RUNTIME_CONFIG');
  const input = JSON.parse(bytes);
  const selected = selectRuntimeConfig(role, input);
  if (Object.keys(input).some((name) => !Object.hasOwn(selected, name)))
    throw new Error('UNEXPECTED_SERVICE_SECRET');
  return selected;
}
export async function splitRuntimeSecrets(inputFile, outputDirectory) {
  const input = JSON.parse(await readFile(inputFile, 'utf8'));
  selectRuntimeConfig('preflight', input);
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await readdir(directory)).length)
    throw new Error('EMPTY_SECRETS_DIRECTORY_REQUIRED');
  for (const role of [
    'web',
    'worker',
    'monitor',
    'backup',
    'migrate',
    'preflight',
  ]) {
    const selected = selectRuntimeConfig(role, input);
    await writeFile(
      join(directory, `${role}.json`),
      JSON.stringify(selected, null, 2) + '\n',
      { flag: 'wx', mode: 0o400 },
    );
  }
}
