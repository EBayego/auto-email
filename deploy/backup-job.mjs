import { parseEnv, parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeployment, composeArguments } from './release.mjs';
import { withDeploymentLock } from './lock.mjs';

function servicesFromJson(text) {
  return text.trim().startsWith('[')
    ? JSON.parse(text)
    : text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}
async function resumeServices(run, active) {
  if (!active.length) return;
  // `start --wait` is unavailable in some supported Compose versions.
  // Start the existing containers, then check their configured health.
  await run(['start', ...active]);
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const states = servicesFromJson(await run(['ps', '--format', 'json']));
    if (
      active.every((name) =>
        states.some(
          (service) =>
            service.Service === name &&
            service.State === 'running' &&
            service.Health === 'healthy',
        ),
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('BACKUP_SERVICE_RECOVERY_FAILED');
}
export async function backupJob(configFile, runner) {
  return withDeploymentLock(
    path.dirname(path.resolve(configFile)),
    async () => {
      const config = validateDeployment(
        parseEnv(await readFile(configFile, 'utf8')),
      );
      if (config.BACKUP_MODE === 'deferred') {
        console.log(
          JSON.stringify({
            type: 'BACKUP_JOB_SKIPPED',
            reason: 'BACKUPS_DEFERRED',
            restoredAndVerified: false,
          }),
        );
        return;
      }
      const run =
        runner ??
        ((args) =>
          new Promise((resolve, reject) => {
            const child = spawn(
              'docker',
              ['compose', ...composeArguments(config), ...args],
              {
                env: {
                  PATH: process.env.PATH,
                  HOME: process.env.HOME,
                  ...config,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
              },
            );
            let output = '';
            child.stdout.on('data', (chunk) => {
              if (output.length < 1024 * 1024) output += chunk;
            });
            child.stderr.resume();
            child.once('error', () => reject(new Error('BACKUP_JOB_FAILED')));
            child.once('exit', (code) =>
              code === 0
                ? resolve(output)
                : reject(new Error('BACKUP_JOB_FAILED')),
            );
          }));
      const text = await run(['ps', '--format', 'json']);
      const services = servicesFromJson(text);
      const active = services
        .filter(
          (s) =>
            ['web', 'worker', 'monitor'].includes(s.Service) &&
            s.State === 'running',
        )
        .map((s) => s.Service);
      let snapshot;
      try {
        if (active.length) await run(['stop', '--timeout', '90', ...active]);
        await run(['run', '--rm', 'backup']);
        const verified = await run([
          'run',
          '--rm',
          'backup',
          'backup',
          'verify',
        ]);
        for (const line of (verified ?? '').trim().split('\n')) {
          try {
            const report = JSON.parse(line);
            if (
              report.type === 'BACKUP_COMPLETED' &&
              /^[a-f0-9]{64}$/.test(report.snapshot ?? '')
            )
              snapshot = report.snapshot;
          } catch {
            /* Only structured backup metadata is included in the journal. */
          }
        }
      } finally {
        await resumeServices(run, active);
      }
      console.log(
        JSON.stringify({
          type: 'BACKUP_JOB_COMPLETED',
          restoredAndVerified: true,
          ...(snapshot ? { snapshot } : {}),
        }),
      );
    },
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: { config: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });
  if (!values.config) throw new Error('CONFIGURATION_REQUIRED');
  await backupJob(values.config).catch(() => {
    console.error(JSON.stringify({ type: 'BACKUP_JOB_FAILED' }));
    process.exitCode = 1;
  });
}
