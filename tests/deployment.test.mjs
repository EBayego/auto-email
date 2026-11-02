import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  selectRuntimeConfig,
  loadRuntimeConfig,
  splitRuntimeSecrets,
} from '../deploy/runtime-config.mjs';
import {
  validateDeployment,
  releaseMain,
  composeArguments,
} from '../deploy/release.mjs';
import { parseEnv } from 'node:util';
import { backupJob } from '../deploy/backup-job.mjs';
import { withDeploymentLock } from '../deploy/lock.mjs';
import { checkServiceHealth } from '../deploy/healthcheck.mjs';
import {
  fileHash,
  safeBackupPath,
  verifyBackupDirectory,
  collectLedger,
  collectStorage,
} from '../deploy/backup.mjs';

const directories = [];
async function directory() {
  const value = await mkdtemp(path.join(tmpdir(), 'auto-email-deployment-'));
  directories.push(value);
  return value;
}
afterEach(async () => {
  for (const root of directories.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function deploymentFile(overrides = {}) {
  const root = await directory();
  const config = {
    COMPOSE_PROJECT_NAME: 'auto-email-prod',
    APP_IMAGE: `ghcr.io/example/app@sha256:${'a'.repeat(64)}`,
    OPS_IMAGE: `ghcr.io/example/ops@sha256:${'b'.repeat(64)}`,
    WEB_BIND_PORT: '3087',
    SECRETS_DIRECTORY: path.join(root, 'secrets'),
    ERASURE_LEDGER_HOST_PATH: path.join(root, 'ledger'),
    BACKUP_STAGING_HOST_PATH: path.join(root, 'backups'),
    ...overrides,
  };
  const file = path.join(root, 'deployment.env');
  await writeFile(
    file,
    Object.entries(config)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join('\n'),
  );
  return { root, file, config };
}
describe('MAIL-067 secretos por proceso', () => {
  const input = {
    APP_ENV: 'production',
    OPENAI_API_KEY: 'private-openai',
    GOOGLE_CLIENT_SECRET: 'private-google',
    GMAIL_TOKEN_ENCRYPTION_KEY: 'private-gmail',
    ALERT_WEBHOOK_BEARER_TOKEN: 'private-alert',
    SUPABASE_ACCESS_TOKEN: 'private-admin',
    SUPABASE_DB_PASSWORD: 'private-password',
    AWS_SECRET_ACCESS_KEY: 'private-backup',
    ERASURE_LEDGER_ENCRYPTION_KEY: 'private-ledger',
  };
  it('web recibe OAuth y cifrado, sin OpenAI, backups, alertas ni administración de la base', () => {
    expect(selectRuntimeConfig('web', input)).toEqual({
      APP_ENV: 'production',
      GOOGLE_CLIENT_SECRET: 'private-google',
      GMAIL_TOKEN_ENCRYPTION_KEY: 'private-gmail',
      ERASURE_LEDGER_ENCRYPTION_KEY: 'private-ledger',
    });
  });
  it('monitor no recibe Gmail, OpenAI ni la clave del registro', () =>
    expect(selectRuntimeConfig('monitor', input)).toEqual({
      APP_ENV: 'production',
      ALERT_WEBHOOK_BEARER_TOKEN: 'private-alert',
    }));
  it('backup no recibe claves de proveedores ni administración de migraciones', () =>
    expect(selectRuntimeConfig('backup', input)).toEqual({
      APP_ENV: 'production',
      AWS_SECRET_ACCESS_KEY: 'private-backup',
    }));
  it('la administración de migraciones queda fuera de los procesos permanentes', () =>
    expect(selectRuntimeConfig('migrate', input)).toEqual({
      SUPABASE_ACCESS_TOKEN: 'private-admin',
      SUPABASE_DB_PASSWORD: 'private-password',
    }));
  it('rechaza secretos inesperados en un archivo de servicio', async () => {
    const file = path.join(await directory(), 'web.json');
    await writeFile(file, JSON.stringify(input));
    await expect(loadRuntimeConfig('web', file)).rejects.toThrow(
      'UNEXPECTED_SERVICE_SECRET',
    );
  });
  it.each([
    null,
    [],
    { OPENAI_API_KEY: { secret: true } },
    { OPENAI_API_KEY: 'unsafe\0value' },
  ])('rechaza configuraciones malformadas', (value) =>
    expect(() => selectRuntimeConfig('worker', value)).toThrow(),
  );
  it('separa archivos y no sobrescribe secretos existentes', async () => {
    const root = await directory(),
      file = path.join(root, 'operator.json'),
      target = path.join(root, 'secrets');
    await writeFile(file, JSON.stringify(input));
    await splitRuntimeSecrets(file, target);
    expect(await readdir(target)).toHaveLength(6);
    expect(
      await loadRuntimeConfig('worker', path.join(target, 'worker.json')),
    ).not.toHaveProperty('ALERT_WEBHOOK_BEARER_TOKEN');
    await expect(splitRuntimeSecrets(file, target)).rejects.toThrow();
  });
  it('no mezcla generaciones de secretos en un directorio parcialmente preparado', async () => {
    const root = await directory(),
      inputFile = path.join(root, 'operator.json'),
      target = path.join(root, 'secrets');
    await writeFile(inputFile, JSON.stringify(input));
    await mkdir(target);
    await writeFile(
      path.join(target, 'worker.json'),
      'previous-secret-generation',
    );
    await expect(splitRuntimeSecrets(inputFile, target)).rejects.toThrow(
      'EMPTY_SECRETS_DIRECTORY_REQUIRED',
    );
    expect(await readdir(target)).toEqual(['worker.json']);
  });
});
describe('salud y recuperación de procesos', () => {
  it('distingue un proceso vivo de un backend no preparado', async () => {
    const file = path.join(await directory(), 'pulse.json');
    await writeFile(
      file,
      JSON.stringify({ role: 'web', pid: 12, at: Date.now() }),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    await expect(checkServiceHealth('web', file, fetcher)).rejects.toThrow();
    fetcher.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(
      checkServiceHealth('web', file, fetcher),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/health/ready',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it.each([
    { role: 'worker', pid: 12, at: 0 },
    { role: 'other', pid: 12, at: 1000000 },
    { role: 'worker', pid: 12, at: 1000000000 },
    { role: 'worker', pid: -1, at: 1000000 },
  ])('rechaza señales caducadas o incoherentes', async (pulse) => {
    const file = path.join(await directory(), 'pulse.json');
    await writeFile(file, JSON.stringify(pulse));
    await expect(
      checkServiceHealth('worker', file, vi.fn(), 1000000),
    ).rejects.toThrow('SERVICE_NOT_LIVE');
  });
  it('evita que una copia y una migración se ejecuten a la vez', async () => {
    const root = await directory();
    let done;
    const first = withDeploymentLock(
      root,
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    await vi.waitFor(() => expect(done).toBeTypeOf('function'));
    await expect(withDeploymentLock(root, async () => {})).rejects.toThrow(
      'DEPLOYMENT_OPERATION_ALREADY_RUNNING',
    );
    done();
    await first;
    await expect(
      withDeploymentLock(root, async () => {}),
    ).resolves.toBeUndefined();
  });
});
describe('despliegue y rollback reproducibles', () => {
  it('exige backup por defecto y rechaza modos desconocidos o vacíos', async () => {
    const { config } = await deploymentFile();
    expect(validateDeployment(config).BACKUP_MODE).toBe('required');
    for (const BACKUP_MODE of ['', 'false', 'disabled', 'defered'])
      expect(() => validateDeployment({ ...config, BACKUP_MODE })).toThrow(
        'INVALID_BACKUP_MODE',
      );
  });
  it('el plan muestra el aplazamiento sin ejecutar Docker', async () => {
    const d = await deploymentFile({ BACKUP_MODE: 'deferred' });
    const runner = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await releaseMain(['--config', d.file], runner);
    expect(runner).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls.at(-1)[0])).toMatchObject({
      backupMode: 'deferred',
      backupBeforeMigrations: false,
    });
  });
  it('permite aplazar solo las copias y conserva preflight, ledger, migración y salud', async () => {
    const d = await deploymentFile({ BACKUP_MODE: 'deferred' });
    const runner = vi.fn().mockResolvedValue('');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await releaseMain(
      ['--config', d.file, '--action', 'deploy', '--confirmed'],
      runner,
    );
    const calls = runner.mock.calls.map(([args]) => args);
    expect(calls.some((args) => args.includes('backup'))).toBe(false);
    expect(calls).toContainEqual(['run', '--rm', 'ledger-init']);
    expect(calls).toContainEqual(['run', '--rm', 'preflight']);
    expect(calls).toContainEqual(['run', '--rm', 'migrate']);
    expect(calls.at(-1)).toContain('--wait');
    expect(JSON.parse(warn.mock.calls.at(-1)[0])).toMatchObject({
      type: 'DEPLOYMENT_BACKUP_DEFERRED',
      backupBeforeMigrations: false,
    });
    expect(parseEnv(await readFile(d.file, 'utf8')).BACKUP_MODE).toBe(
      'deferred',
    );
    const releases = path.join(d.root, 'releases');
    const [receipt] = await readdir(releases);
    expect(
      JSON.parse(await readFile(path.join(releases, receipt), 'utf8')),
    ).toMatchObject({
      backupMode: 'deferred',
      backupBeforeMigrations: false,
    });
  });
  it('un backup obligatorio fallido impide migrar y arrancar la app', async () => {
    const d = await deploymentFile({ BACKUP_MODE: 'required' });
    const runner = vi.fn(async (args) => {
      if (args[0] === 'run' && args.includes('backup'))
        throw new Error('synthetic backup failure');
    });
    await expect(
      releaseMain(
        ['--config', d.file, '--action', 'deploy', '--confirmed'],
        runner,
      ),
    ).rejects.toThrow('synthetic backup failure');
    expect(
      runner.mock.calls.some(
        ([args]) => args[0] === 'run' && args.includes('migrate'),
      ),
    ).toBe(false);
    expect(runner.mock.calls.some(([args]) => args[0] === 'up')).toBe(false);
  });
  it('el job aplazado no toca Docker ni detiene servicios ni acredita una copia', async () => {
    const d = await deploymentFile({ BACKUP_MODE: 'deferred' });
    const runner = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await backupJob(d.file, runner);
    expect(runner).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls.at(-1)[0])).toEqual({
      type: 'BACKUP_JOB_SKIPPED',
      reason: 'BACKUPS_DEFERRED',
      restoredAndVerified: false,
    });
  });
  it('solo conecta web a la red existente del proxy cuando se configura explícitamente', async () => {
    const { config } = await deploymentFile();
    expect(composeArguments(config)).toHaveLength(2);
    const selected = validateDeployment({
      ...config,
      PROXY_NETWORK_NAME: 'existing.proxy-network',
    });
    expect(composeArguments(selected)).toHaveLength(4);
    expect(composeArguments(selected).at(-1)).toMatch(
      /compose\.proxy-network\.yaml$/,
    );
    expect(() =>
      validateDeployment({ ...config, PROXY_NETWORK_NAME: 'unsafe\nnetwork' }),
    ).toThrow('INVALID_PROXY_NETWORK');
  });
  it('el plan no ejecuta Docker ni modifica los servicios', async () => {
    const d = await deploymentFile(),
      runner = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await releaseMain(['--config', d.file], runner);
    expect(runner).not.toHaveBeenCalled();
  });
  it('exige confirmación y una imagen inmutable', async () => {
    const d = await deploymentFile();
    await expect(
      releaseMain(['--config', d.file, '--action', 'deploy'], vi.fn()),
    ).rejects.toThrow('DEPLOYMENT_CONFIRMATION_REQUIRED');
    expect(() =>
      validateDeployment({ ...d.config, APP_IMAGE: 'example/app:latest' }),
    ).toThrow('IMMUTABLE_IMAGE_REQUIRED');
    expect(() =>
      validateDeployment({
        ...d.config,
        COMPOSE_PROJECT_NAME: 'another-project',
      }),
    ).toThrow();
  });
  it('hace backup antes de migrar y comprueba salud antes de guardar la versión', async () => {
    const d = await deploymentFile(),
      runner = vi.fn().mockResolvedValue('');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await releaseMain(
      ['--config', d.file, '--action', 'deploy', '--confirmed'],
      runner,
    );
    const calls = runner.mock.calls.map(([params]) => params.join(' '));
    expect(calls.indexOf('run --rm backup')).toBeLessThan(
      calls.indexOf('run --rm migrate'),
    );
    expect(calls.at(-1)).toContain('up -d --wait');
    expect(await readdir(path.join(d.root, 'releases'))).toHaveLength(1);
  });
  it('si falla una migración deja los procesos detenidos sin abrir tráfico', async () => {
    const d = await deploymentFile(),
      runner = vi.fn(async (args) => {
        if (args.includes('migrate') && args[0] === 'run')
          throw new Error('synthetic failure');
      });
    await expect(
      releaseMain(
        ['--config', d.file, '--action', 'deploy', '--confirmed'],
        runner,
      ),
    ).rejects.toThrow();
    expect(runner.mock.calls.at(-1)[0][0]).toBe('stop');
    expect(runner.mock.calls.some(([a]) => a[0] === 'up')).toBe(false);
  });
  it('rollback exige revisar el esquema y nunca ejecuta migraciones inversas', async () => {
    const d = await deploymentFile(),
      release = path.join(d.root, 'previous.json');
    await writeFile(
      release,
      JSON.stringify({
        appImage: `ghcr.io/example/app@sha256:${'c'.repeat(64)}`,
        opsImage: `ghcr.io/example/ops@sha256:${'d'.repeat(64)}`,
      }),
    );
    await expect(
      releaseMain(
        [
          '--config',
          d.file,
          '--action',
          'rollback',
          '--release',
          release,
          '--confirmed',
        ],
        vi.fn(),
      ),
    ).rejects.toThrow('REVIEW_SCHEMA_COMPATIBILITY');
    const runner = vi.fn().mockResolvedValue('');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await releaseMain(
      [
        '--config',
        d.file,
        '--action',
        'rollback',
        '--release',
        release,
        '--confirmed',
        '--schema-compatible',
      ],
      runner,
    );
    expect(
      runner.mock.calls.some(
        ([args]) => args[0] === 'run' && args.includes('migrate'),
      ),
    ).toBe(false);
    const saved = parseEnv(await readFile(d.file, 'utf8'));
    expect(saved.APP_IMAGE).toContain('c'.repeat(64));
    expect(saved.OPS_IMAGE).toContain('d'.repeat(64));
    expect(saved.WEB_BIND_PORT).toBe(d.config.WEB_BIND_PORT);
  });
  it('el backup diario solo reanuda servicios que ya estaban arrancados, incluso si falla la copia', async () => {
    const d = await deploymentFile(),
      runner = vi.fn(async (args) => {
        if (args[0] === 'ps')
          return JSON.stringify([
            { Service: 'web', State: 'running', Health: 'healthy' },
            { Service: 'worker', State: 'exited' },
          ]);
        if (args[0] === 'run') throw new Error('synthetic backup failure');
        return '';
      });
    await expect(backupJob(d.file, runner)).rejects.toThrow();
    expect(runner.mock.calls.map(([args]) => args)).toContainEqual([
      'start',
      'web',
    ]);
    expect(runner.mock.calls.at(-1)[0]).toEqual(['ps', '--format', 'json']);
  });
  it('no reanuda servicios detenidos antes de una copia programada', async () => {
    const d = await deploymentFile(),
      runner = vi.fn(async (args) => (args[0] === 'ps' ? '[]' : ''));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await backupJob(d.file, runner);
    expect(runner.mock.calls.map(([args]) => args[0])).toEqual([
      'ps',
      'run',
      'run',
    ]);
  });
});
describe('integridad de backups', () => {
  it.each([
    '../secret',
    '/etc/passwd',
    'storage/../secret',
    'storage\\secret',
    'a//b',
  ])('rechaza rutas fuera del backup: %s', (value) =>
    expect(() => safeBackupPath('/safe', value)).toThrow('INVALID_BACKUP_PATH'),
  );
  it('verifica bytes restaurados y detecta alteraciones de contenido', async () => {
    const root = await directory();
    await mkdir(path.join(root, 'ledger'));
    await writeFile(path.join(root, 'database.dump'), 'synthetic-dump');
    await writeFile(path.join(root, 'ledger/.ledger'), 'synthetic-marker');
    const files = await Promise.all(
      ['database.dump', 'ledger/.ledger'].map(async (file) => ({
        path: file,
        sha256: await fileHash(path.join(root, file)),
        bytes: (await readFile(path.join(root, file))).length,
      })),
    );
    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({ version: 1, projectRef: 'zbcexekelujsqkkynsog', files }),
    );
    expect(await verifyBackupDirectory(root)).toEqual({
      files: 2,
      storageObjects: 0,
    });
    await writeFile(path.join(root, 'database.dump'), 'corrupt');
    await expect(verifyBackupDirectory(root)).rejects.toThrow(
      'BACKUP_INTEGRITY_FAILED',
    );
  });
  it('un registro sin inicializar bloquea la copia', async () => {
    const root = await directory();
    await expect(collectLedger(root, root)).rejects.toThrow(
      'LEDGER_NOT_INITIALIZED',
    );
  });
  it('no acepta una descarga de Storage cambiada durante la copia', async () => {
    const root = await directory(),
      document = {
        id: crypto.randomUUID(),
        user_id: crypto.randomUUID(),
        sha256: 'a'.repeat(64),
        byte_size: 4,
      };
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: async () => ({ data: [document], error: null }),
    };
    const client = {
      from: () => query,
      storage: {
        from: () => ({
          download: async () => ({ data: new Blob(['test']), error: null }),
        }),
      },
    };
    await expect(collectStorage(client, root)).rejects.toThrow(
      'BACKUP_STORAGE_CHANGED',
    );
  });
});
