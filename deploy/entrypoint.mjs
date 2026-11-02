import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { loadRuntimeConfig } from './runtime-config.mjs';

const role = process.argv[2];
const roles = new Set([
  'web',
  'worker',
  'monitor',
  'backup',
  'migrate',
  'ledger-init',
  'security-contain',
  'security-restore',
  'security-release',
  'preflight',
]);
if (!roles.has(role)) throw new Error('INVALID_SERVICE_ROLE');
const secretRole = [
  'ledger-init',
  'security-contain',
  'security-restore',
  'security-release',
].includes(role)
  ? 'worker'
  : role;
try {
  const config = await loadRuntimeConfig(
    secretRole,
    process.env.AUTO_EMAIL_CONFIG_FILE ?? '/run/secrets/runtime.json',
  );
  const healthFile = '/tmp/auto-email-health.json';
  const env = {
    PATH: process.env.PATH,
    HOME: '/tmp',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    HOSTNAME: '0.0.0.0',
    PORT: '3000',
    ...config,
    ...(['web', 'worker', 'monitor'].includes(role)
      ? { AUTO_EMAIL_HEALTH_FILE: healthFile }
      : {}),
  };
  const commands = {
    web: ['server.js'],
    worker: ['--import', 'tsx', 'scripts/worker-sync.ts'],
    monitor: ['--import', 'tsx', 'scripts/ops-monitor.ts'],
    backup: ['deploy/backup.mjs', ...process.argv.slice(3)],
    migrate: ['deploy/migrate.mjs'],
    'ledger-init': [
      '--import',
      'tsx',
      'scripts/security-maintenance.ts',
      '--action',
      'init',
      '--confirmed',
    ],
    'security-contain': [
      '--import',
      'tsx',
      'scripts/security-maintenance.ts',
      '--action',
      'contain',
      '--confirmed',
    ],
    'security-restore': [
      '--import',
      'tsx',
      'scripts/security-maintenance.ts',
      '--action',
      'restore',
      '--confirmed',
    ],
    'security-release': [
      '--import',
      'tsx',
      'scripts/security-maintenance.ts',
      '--action',
      'release',
      '--confirmed',
    ],
    preflight: ['--import', 'tsx', 'scripts/production-check.ts'],
  };
  await unlink(healthFile).catch(() => {});
  const child = spawn(process.execPath, commands[role], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  let stopping = false;
  const started = Date.now();
  const persistent = ['web', 'worker', 'monitor'].includes(role);
  const watchdog = persistent
    ? setInterval(async () => {
        if (stopping) return;
        try {
          const pulse = JSON.parse(await readFile(healthFile, 'utf8'));
          if (
            pulse.pid === child.pid &&
            pulse.role === role &&
            Number.isSafeInteger(pulse.at) &&
            pulse.at - Date.now() <= 30000 &&
            Date.now() - pulse.at < 90000
          )
            return;
        } catch {
          /* A service which never becomes live is also restarted. */
        }
        if (Date.now() - started > 120000) {
          console.error(
            JSON.stringify({ type: 'SERVICE_WATCHDOG_FAILED', role }),
          );
          child.kill('SIGKILL');
        }
      }, 20000)
    : null;
  const stop = (signal) => {
    stopping = true;
    child.kill(signal);
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  child.once('error', () => {
    if (watchdog) clearInterval(watchdog);
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    if (watchdog) clearInterval(watchdog);
    process.exitCode = stopping ? 0 : (code ?? 1);
  });
} catch {
  console.error(
    JSON.stringify({ type: 'SERVICE_CONFIGURATION_INVALID', role }),
  );
  process.exitCode = 1;
}
