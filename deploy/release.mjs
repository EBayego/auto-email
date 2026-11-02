import { parseArgs, parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withDeploymentLock } from './lock.mjs';

const variables = [
  'COMPOSE_PROJECT_NAME',
  'APP_IMAGE',
  'OPS_IMAGE',
  'WEB_BIND_PORT',
  'SECRETS_DIRECTORY',
  'ERASURE_LEDGER_HOST_PATH',
  'BACKUP_STAGING_HOST_PATH',
];
export function composeArguments(config) {
  const files = [
    '-f',
    fileURLToPath(new URL('./compose.yaml', import.meta.url)),
  ];
  if (config.PROXY_NETWORK_NAME)
    files.push(
      '-f',
      fileURLToPath(new URL('./compose.proxy-network.yaml', import.meta.url)),
    );
  return files;
}
export function validateDeployment(input) {
  if (
    Object.keys(input).some(
      (key) =>
        ![...variables, 'PROXY_NETWORK_NAME', 'BACKUP_MODE'].includes(key),
    ) ||
    !/^auto-email-[a-z0-9-]{1,32}$/.test(input.COMPOSE_PROJECT_NAME ?? '')
  )
    throw new Error('INVALID_DEPLOYMENT_CONFIGURATION');
  const backupMode = input.BACKUP_MODE ?? 'required';
  if (!['required', 'deferred'].includes(backupMode))
    throw new Error('INVALID_BACKUP_MODE');
  for (const key of ['APP_IMAGE', 'OPS_IMAGE'])
    if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(input[key] ?? ''))
      throw new Error('IMMUTABLE_IMAGE_REQUIRED');
  const port = Number(input.WEB_BIND_PORT);
  if (!/^\d+$/.test(input.WEB_BIND_PORT ?? '') || port < 1024 || port > 65535)
    throw new Error('INVALID_DEPLOYMENT_PORT');
  for (const key of [
    'SECRETS_DIRECTORY',
    'ERASURE_LEDGER_HOST_PATH',
    'BACKUP_STAGING_HOST_PATH',
  ])
    if (
      !path.isAbsolute(input[key] ?? '') ||
      path.resolve(input[key]) === path.parse(input[key]).root
    )
      throw new Error('INVALID_DEPLOYMENT_PATH');
  if (
    new Set(
      [
        'SECRETS_DIRECTORY',
        'ERASURE_LEDGER_HOST_PATH',
        'BACKUP_STAGING_HOST_PATH',
      ].map((key) => path.resolve(input[key])),
    ).size !== 3
  )
    throw new Error('DEPLOYMENT_PATHS_MUST_DIFFER');
  if (
    input.PROXY_NETWORK_NAME &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(input.PROXY_NETWORK_NAME)
  )
    throw new Error('INVALID_PROXY_NETWORK');
  return {
    ...Object.fromEntries(variables.map((name) => [name, input[name]])),
    BACKUP_MODE: backupMode,
    ...(input.PROXY_NETWORK_NAME
      ? { PROXY_NETWORK_NAME: input.PROXY_NETWORK_NAME }
      : {}),
  };
}
async function saveConfiguration(file, config) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      Object.entries(config)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export async function releaseMain(args = process.argv.slice(2), runner) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      config: { type: 'string' },
      action: { type: 'string', default: 'plan' },
      release: { type: 'string' },
      confirmed: { type: 'boolean' },
      'schema-compatible': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Uso: node deploy/release.mjs --config /srv/auto-email-prod/deployment.env --action plan|deploy|rollback [--release archivo.json] [--confirmed] [--schema-compatible]\nNo modifica el proxy de la VPS. Un fallo deja los procesos detenidos para revisión. Rollback cambia imágenes, nunca revierte la base automáticamente.',
    );
    return;
  }
  if (!values.config || !['plan', 'deploy', 'rollback'].includes(values.action))
    throw new Error('INVALID_DEPLOYMENT_ACTION');
  const config = validateDeployment(
    parseEnv(await readFile(values.config, 'utf8')),
  );
  if (values.action === 'rollback') {
    if (!values.release || !values['schema-compatible'])
      throw new Error('REVIEW_SCHEMA_COMPATIBILITY');
    const previous = JSON.parse(await readFile(values.release, 'utf8'));
    Object.assign(
      config,
      validateDeployment({
        ...config,
        APP_IMAGE: previous.appImage,
        OPS_IMAGE: previous.opsImage,
      }),
    );
  }
  if (values.action === 'plan') {
    console.log(
      JSON.stringify({
        action: 'plan',
        project: config.COMPOSE_PROJECT_NAME,
        appImage: config.APP_IMAGE,
        opsImage: config.OPS_IMAGE,
        bind: `127.0.0.1:${config.WEB_BIND_PORT}`,
        backupMode: config.BACKUP_MODE,
        backupBeforeMigrations: config.BACKUP_MODE === 'required',
      }),
    );
    return;
  }
  if (!values.confirmed) throw new Error('DEPLOYMENT_CONFIRMATION_REQUIRED');
  if (config.BACKUP_MODE === 'deferred')
    console.warn(
      JSON.stringify({
        type: 'DEPLOYMENT_BACKUP_DEFERRED',
        backupBeforeMigrations: false,
      }),
    );
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    DOCKER_CONFIG: process.env.DOCKER_CONFIG,
    DOCKER_HOST: process.env.DOCKER_HOST,
    ...config,
  };
  const run =
    runner ??
    ((params) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          'docker',
          ['compose', ...composeArguments(config), ...params],
          { env, stdio: 'inherit', windowsHide: true },
        );
        child.once('error', () =>
          reject(new Error('DEPLOYMENT_COMMAND_UNAVAILABLE')),
        );
        child.once('exit', (code) =>
          code === 0
            ? resolve()
            : reject(new Error('DEPLOYMENT_COMMAND_FAILED')),
        );
      }));
  return withDeploymentLock(
    path.dirname(path.resolve(values.config)),
    async () => {
      await run(['config', '--quiet']);
      await run([
        'pull',
        'web',
        'worker',
        'monitor',
        'preflight',
        'ledger-init',
        ...(config.BACKUP_MODE === 'required' ? ['backup'] : []),
        'migrate',
      ]);
      await run(['run', '--rm', 'ledger-init']);
      await run(['run', '--rm', 'preflight']);
      await run(['stop', '--timeout', '90', 'web', 'worker', 'monitor']);
      try {
        if (values.action === 'deploy') {
          if (config.BACKUP_MODE === 'required')
            await run(['run', '--rm', 'backup']);
          await run(['run', '--rm', 'migrate']);
        }
        await run([
          'up',
          '-d',
          '--wait',
          '--wait-timeout',
          '180',
          'web',
          'worker',
          'monitor',
        ]);
        // Keep scheduled backups on the selected release after a rollback.
        // Persist under the same lock before any background operation resumes.
        await saveConfiguration(path.resolve(values.config), config);
        const directory = path.join(
          path.dirname(path.resolve(values.config)),
          'releases',
        );
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(
          path.join(directory, `${Date.now()}-${randomUUID()}.json`),
          JSON.stringify(
            {
              version: 1,
              appImage: config.APP_IMAGE,
              opsImage: config.OPS_IMAGE,
              action: values.action,
              backupMode: config.BACKUP_MODE,
              backupBeforeMigrations:
                values.action === 'deploy' && config.BACKUP_MODE === 'required',
              at: new Date().toISOString(),
            },
            null,
            2,
          ),
          { mode: 0o600, flag: 'wx' },
        );
      } catch (error) {
        await run([
          'stop',
          '--timeout',
          '90',
          'web',
          'worker',
          'monitor',
        ]).catch(() => {});
        throw error;
      }
      console.log(
        JSON.stringify({
          type: 'DEPLOYMENT_COMPLETED',
          action: values.action,
          project: config.COMPOSE_PROJECT_NAME,
          backupMode: config.BACKUP_MODE,
        }),
      );
    },
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  releaseMain().catch((error) => {
    console.error(
      [
        'REVIEW_SCHEMA_COMPATIBILITY',
        'DEPLOYMENT_CONFIRMATION_REQUIRED',
      ].includes(error.message)
        ? error.message
        : 'DEPLOYMENT_FAILED_REVIEW_BEFORE_RESUMING',
    );
    process.exitCode = 1;
  });
