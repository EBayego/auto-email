import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  lstat,
  copyFile,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '',
      exceeded = false;
    child.stdout.on('data', (chunk) => {
      if (output.length + chunk.length > 16 * 1024 * 1024) {
        exceeded = true;
        child.kill();
      } else output += chunk;
    });
    child.stderr.resume();
    child.once('error', () => reject(new Error('BACKUP_COMMAND_UNAVAILABLE')));
    child.once('exit', (code) =>
      code === 0 && !exceeded
        ? resolve(output)
        : reject(new Error('BACKUP_COMMAND_FAILED')),
    );
  });
}
export function safeBackupPath(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative) ||
    relative
      .split('/')
      .some((part) => part === '.' || part === '..' || part === '')
  )
    throw new Error('INVALID_BACKUP_PATH');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw new Error('INVALID_BACKUP_PATH');
  return target;
}
async function cleanupTemporary(root, directory) {
  const resolved = path.resolve(directory);
  if (
    !resolved.startsWith(path.resolve(root) + path.sep) ||
    !path.basename(resolved).startsWith('auto-email-backup-')
  )
    throw new Error('INVALID_BACKUP_DIRECTORY');
  await rm(resolved, { recursive: true, force: true });
}
async function temporary(root, operation) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (
    !(await lstat(root)).isDirectory() ||
    (await lstat(root)).isSymbolicLink()
  )
    throw new Error('INVALID_BACKUP_DIRECTORY');
  const directory = await mkdtemp(path.join(root, 'auto-email-backup-'));
  try {
    return await operation(directory);
  } finally {
    await cleanupTemporary(root, directory);
  }
}
export async function collectStorage(client, directory) {
  const files = [];
  for (let offset = 0; ; offset += 100) {
    const result = await client
      .from('source_documents')
      .select('id,user_id,sha256,byte_size')
      .eq('has_file', true)
      .order('id')
      .range(offset, offset + 99);
    if (result.error || !result.data)
      throw new Error('BACKUP_STORAGE_INDEX_FAILED');
    for (const document of result.data) {
      if (!uuid.test(document.id) || !uuid.test(document.user_id))
        throw new Error('INVALID_STORAGE_REFERENCE');
      const key = `${document.user_id}/${document.id}`;
      const file = safeBackupPath(directory, `storage/${key}`);
      const result = await client.storage
        .from('knowledge-documents')
        .download(key);
      if (
        result.error ||
        !result.data ||
        result.data.size !== document.byte_size ||
        result.data.size > 10 * 1024 * 1024
      )
        throw new Error('BACKUP_STORAGE_FAILED');
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, Buffer.from(await result.data.arrayBuffer()), {
        mode: 0o600,
      });
      const sha256 = await fileHash(file);
      if (sha256 !== document.sha256) throw new Error('BACKUP_STORAGE_CHANGED');
      files.push({ path: `storage/${key}`, sha256, bytes: document.byte_size });
    }
    if (result.data.length < 100) return files;
  }
}
export async function collectLedger(source, directory) {
  if (!path.isAbsolute(source) || (await lstat(source)).isSymbolicLink())
    throw new Error('INVALID_LEDGER_DIRECTORY');
  const names = (await readdir(source)).filter(
    (name) => name === '.ledger' || /^[a-f0-9]{64}\.erasure$/.test(name),
  );
  if (!names.includes('.ledger')) throw new Error('LEDGER_NOT_INITIALIZED');
  const files = [];
  for (const name of names) {
    const original = path.join(source, name),
      info = await lstat(original);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2048)
      throw new Error('INVALID_LEDGER_RECORD');
    const relative = `ledger/${name}`,
      file = safeBackupPath(directory, relative);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await copyFile(original, file);
    files.push({
      path: relative,
      sha256: await fileHash(file),
      bytes: info.size,
    });
  }
  return files;
}
export async function verifyBackupDirectory(directory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    manifest.projectRef !== 'zbcexekelujsqkkynsog' ||
    !Array.isArray(manifest.files) ||
    !manifest.files.some((file) => file.path === 'database.dump') ||
    !manifest.files.some((file) => file.path === 'ledger/.ledger')
  )
    throw new Error('INVALID_BACKUP_MANIFEST');
  for (const file of manifest.files) {
    const target = safeBackupPath(directory, file.path),
      info = await lstat(target);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size !== file.bytes ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      (await fileHash(target)) !== file.sha256
    )
      throw new Error('BACKUP_INTEGRITY_FAILED');
  }
  return {
    files: manifest.files.length,
    storageObjects: manifest.files.filter((file) =>
      file.path.startsWith('storage/'),
    ).length,
  };
}
export async function backupMain(
  args = process.argv.slice(2),
  env = process.env,
) {
  const [action, snapshot] = args;
  if (
    !['init', 'create', 'verify', 'export'].includes(action) ||
    args.length > (['verify', 'export'].includes(action) ? 2 : 1) ||
    (action === 'export' && !snapshot)
  )
    throw new Error('INVALID_BACKUP_ACTION');
  if (!env.RESTIC_REPOSITORY || !env.RESTIC_PASSWORD_FILE)
    throw new Error('BACKUP_CONFIGURATION_REQUIRED');
  if (
    env.APP_ENV !== 'test' &&
    !/^(s3:https:\/\/|sftp:|rest:https:\/\/)/.test(env.RESTIC_REPOSITORY)
  )
    throw new Error('OFFSITE_BACKUP_REQUIRED');
  const root = env.BACKUP_DIRECTORY ?? '/var/lib/auto-email/backups';
  const run = (command, params, options = {}) =>
    execute(command, params, { env, ...options });
  if (action === 'init') {
    await run('restic', ['init']);
    return { initialized: true };
  }
  if (action === 'create') {
    const days = Number(env.BACKUP_RETENTION_DAYS ?? '30');
    if (!Number.isInteger(days) || days < 1 || days > 30)
      throw new Error('INVALID_BACKUP_RETENTION');
    const api = new URL(env.SUPABASE_URL ?? '');
    if (
      api.username ||
      api.password ||
      api.pathname !== '/' ||
      api.search ||
      api.hash ||
      (api.origin !== 'https://zbcexekelujsqkkynsog.supabase.co' &&
        !(
          env.APP_ENV === 'test' &&
          api.protocol === 'http:' &&
          ['127.0.0.1', 'host.docker.internal'].includes(api.hostname) &&
          api.port === '55321'
        ))
    )
      throw new Error('UNEXPECTED_BACKUP_PROJECT');
    if (!env.PGSERVICEFILE || !env.PGSERVICE)
      throw new Error('BACKUP_DATABASE_CONFIGURATION_REQUIRED');
    const client = createClient(api.origin, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.timeout(30000),
          }),
      },
    });
    return temporary(root, async (directory) => {
      const dump = path.join(directory, 'database.dump');
      await run('pg_dump', [
        '--no-password',
        '--format=custom',
        '--no-owner',
        '--schema=public',
        '--schema=private',
        '--schema=worker_private',
        '--schema=auth',
        '--schema=storage',
        '--schema=supabase_migrations',
        '--file',
        dump,
      ]);
      const files = [
        {
          path: 'database.dump',
          sha256: await fileHash(dump),
          bytes: (await stat(dump)).size,
        },
        ...(await collectStorage(client, directory)),
        ...(await collectLedger(env.ERASURE_LEDGER_DIRECTORY, directory)),
      ];
      await writeFile(
        path.join(directory, 'manifest.json'),
        JSON.stringify({
          version: 1,
          projectRef: 'zbcexekelujsqkkynsog',
          createdAt: new Date().toISOString(),
          files,
        }),
        { mode: 0o600 },
      );
      await verifyBackupDirectory(directory);
      const backupOutput = await run('restic', [
        'backup',
        '--json',
        '--tag',
        'auto-email',
        '--host',
        'auto-email-prod',
        directory,
      ]);
      const summary = backupOutput
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .findLast((item) => item.message_type === 'summary');
      if (!/^[a-f0-9]{64}$/.test(summary?.snapshot_id ?? ''))
        throw new Error('BACKUP_SNAPSHOT_MISSING');
      await run('restic', [
        'forget',
        '--tag',
        'auto-email',
        '--host',
        'auto-email-prod',
        '--keep-within',
        `${days}d`,
        '--prune',
      ]);
      return {
        backedUp: true,
        files: files.length,
        snapshot: summary.snapshot_id,
      };
    });
  }
  if (snapshot && !/^[a-f0-9]{8,64}$/.test(snapshot))
    throw new Error('INVALID_BACKUP_SNAPSHOT');
  const snapshots = JSON.parse(
    await run('restic', [
      'snapshots',
      '--json',
      '--tag',
      'auto-email',
      '--host',
      'auto-email-prod',
      '--latest',
      '1',
      ...(snapshot ? [snapshot] : []),
    ]),
  );
  if (
    snapshots.length !== 1 ||
    snapshots[0].paths.length !== 1 ||
    !/^[a-f0-9]{64}$/.test(snapshots[0].id)
  )
    throw new Error('BACKUP_NOT_FOUND');
  if (action === 'export') {
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (
      !(await lstat(root)).isDirectory() ||
      (await lstat(root)).isSymbolicLink()
    )
      throw new Error('INVALID_BACKUP_DIRECTORY');
    const directory = safeBackupPath(
      root,
      `auto-email-backup-export-${snapshots[0].id}`,
    );
    await mkdir(directory, { mode: 0o700 });
    try {
      await run('restic', ['restore', snapshots[0].id, '--target', directory]);
      const restored = safeBackupPath(
        directory,
        snapshots[0].paths[0].replace(/^\/+/, ''),
      );
      const verified = await verifyBackupDirectory(restored);
      await run('pg_restore', ['--list', path.join(restored, 'database.dump')]);
      return {
        exported: true,
        directory: restored,
        snapshot: snapshots[0].id,
        ...verified,
      };
    } catch (error) {
      await cleanupTemporary(root, directory);
      throw error;
    }
  }
  return temporary(root, async (directory) => {
    await run('restic', ['restore', snapshots[0].id, '--target', directory]);
    const restored = safeBackupPath(
      directory,
      snapshots[0].paths[0].replace(/^\/+/, ''),
    );
    const verified = await verifyBackupDirectory(restored);
    await run('pg_restore', ['--list', path.join(restored, 'database.dump')]);
    return {
      restoredAndVerified: true,
      snapshot: snapshots[0].id,
      ...verified,
    };
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  backupMain()
    .then((result) =>
      console.log(JSON.stringify({ type: 'BACKUP_COMPLETED', ...result })),
    )
    .catch(() => {
      console.error(JSON.stringify({ type: 'BACKUP_FAILED' }));
      process.exitCode = 1;
    });
