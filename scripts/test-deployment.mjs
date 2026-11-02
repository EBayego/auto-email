import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { selectRuntimeConfig } from '../deploy/runtime-config.mjs';
import { createAuthClient } from '../src/modules/auth/client.ts';
import { createErasureLedger } from '../src/modules/security/erasure-ledger.ts';
import { SecretValue } from '../src/config/env.ts';
import { readPrivacyNotice } from '../src/modules/privacy/config.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const suffix = randomUUID().slice(0, 8),
  scratch = path.join(root, '.cache', `mail067-${suffix}`);
const appImage = 'auto-email:mail067-app',
  opsImage = 'auto-email:mail067-ops';
const containers = [],
  users = [];
let service,
  databaseCreated = false,
  supabaseNetwork;
const database = `mail067_restore_${suffix.replaceAll('-', '')}`;
const report = { version: 1, passed: false, phase: 'build' };
async function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: root,
      env: { ...process.env, DO_NOT_TRACK: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '',
      error = '';
    child.stdout.on('data', (chunk) => {
      if (text.length < 16 * 1024 * 1024) text += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (error.length < 16000) error += chunk;
    });
    child.once('error', () =>
      reject(new Error('DEPLOYMENT_DOCKER_UNAVAILABLE')),
    );
    child.once('exit', (code) =>
      code === 0
        ? resolve(text.trim())
        : reject(
            new Error(
              `DEPLOYMENT_DOCKER_FAILED:${args[0]}:${error.slice(0, 2000).replaceAll(/(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+/g, '[REDACTED]')}`,
            ),
          ),
    );
  });
}
async function eventually(test, seconds = 90) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      if (await test()) return;
    } catch {
      /* Wait only for read-only health/state queries. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('DEPLOYMENT_READINESS_TIMEOUT');
}
async function crashService(name) {
  // Killing a container through Docker is an operator stop, which suppresses
  // unless-stopped. Crash the actual application process instead.
  await eventually(
    async () =>
      Date.now() -
        Date.parse(
          await command(['inspect', '--format', '{{.State.StartedAt}}', name]),
        ) >=
      11000,
  );
  await command([
    'exec',
    name,
    'node',
    '-e',
    "const fs=require('node:fs');const pulse=JSON.parse(fs.readFileSync('/tmp/auto-email-health.json','utf8'));process.kill(pulse.pid,'SIGKILL');",
  ]);
}
async function ownedByContainer(paths, uid = 10001, gid = 10001) {
  const script = `const fs=require('fs'),p=require('path');function walk(f){if(!fs.existsSync(f))return;const s=fs.lstatSync(f);if(s.isSymbolicLink())throw Error('symlink');fs.chownSync(f,${uid},${gid});if(s.isDirectory())for(const n of fs.readdirSync(f))walk(p.join(f,n));}for(const n of process.argv.slice(1))walk('/work/'+n);`;
  await command([
    'run',
    '--rm',
    '--user',
    '0:0',
    '--mount',
    `type=bind,source=${scratch},target=/work`,
    '--entrypoint',
    'node',
    appImage,
    '-e',
    script,
    ...paths,
  ]);
}
// The production configuration still uses a loopback Supabase URL. This test-only
// TCP forwarder connects it to the exact local Docker instance, never a provider.
const forwarder = `const net=require('net'),{spawn}=require('child_process');const server=net.createServer(s=>{const t=net.connect(8000,'supabase_kong_auto-email');s.pipe(t).pipe(s);s.on('error',()=>t.destroy());t.on('error',()=>s.destroy());});server.listen(55321,'127.0.0.1',()=>{const c=spawn(process.execPath,['deploy/entrypoint.mjs',...process.argv.slice(1)],{stdio:'inherit'});for(const s of ['SIGTERM','SIGINT'])process.on(s,()=>c.kill(s));c.on('exit',code=>process.exit(code??1));});`;
async function runService(role, options = {}) {
  const name = `auto-email-mail067-${role}-${suffix}`;
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '--restart',
    'unless-stopped',
    '--init',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--add-host',
    'host.docker.internal:host-gateway',
    '--tmpfs',
    '/tmp:rw,nosuid,size=256m,uid=10001,gid=10001',
    '--tmpfs',
    '/app/.next/cache:rw,nosuid,size=128m,uid=10001,gid=10001',
    '--mount',
    `type=bind,source=${path.join(scratch, role + '.json')},target=/run/secrets/runtime.json,readonly`,
  ];
  if (role !== 'monitor')
    args.push(
      '--mount',
      `type=bind,source=${path.join(scratch, 'ledger')},target=/var/lib/auto-email/erasures`,
    );
  if (options.port) args.push('-p', `127.0.0.1:${options.port}:3000`);
  args.push(
    '--health-cmd',
    `node deploy/healthcheck.mjs ${role}`,
    '--health-interval',
    '2s',
    '--health-timeout',
    '5s',
    '--health-start-period',
    '10s',
    '--health-retries',
    '20',
    '--entrypoint',
    'node',
    appImage,
    '-e',
    forwarder,
    role,
  );
  args.splice(1, 0, '--network', supabaseNetwork);
  containers.push(name);
  await command(args);
  await eventually(
    async () =>
      (await command([
        'inspect',
        '--format',
        '{{.State.Health.Status}}',
        name,
      ])) === 'healthy',
  );
  return name;
}
async function backup(...args) {
  return command([
    'run',
    '--rm',
    '--read-only',
    '--network',
    supabaseNetwork,
    '--tmpfs',
    '/tmp:rw,size=128m,uid=10001,gid=10001',
    '--mount',
    `type=bind,source=${path.join(scratch, 'backup.json')},target=/run/secrets/runtime.json,readonly`,
    '--mount',
    `type=bind,source=${path.join(scratch, 'database.conf')},target=/run/secrets/database.conf,readonly`,
    '--mount',
    `type=bind,source=${path.join(scratch, 'backup-password')},target=/run/secrets/backup-password,readonly`,
    '--mount',
    `type=bind,source=${path.join(scratch, 'ledger')},target=/var/lib/auto-email/erasures,readonly`,
    '--mount',
    `type=bind,source=${path.join(scratch, 'repository')},target=/repository`,
    '--mount',
    `type=bind,source=${path.join(scratch, 'staging')},target=/var/lib/auto-email/backups`,
    '--entrypoint',
    'node',
    opsImage,
    '-e',
    forwarder,
    'backup',
    ...args,
  ]);
}
async function restic(args) {
  return command([
    'run',
    '--rm',
    '--mount',
    `type=bind,source=${path.join(scratch, 'repository')},target=/repository`,
    '--mount',
    `type=bind,source=${path.join(scratch, 'backup-password')},target=/run/secrets/pw,readonly`,
    '--mount',
    `type=bind,source=${path.join(scratch, 'restored')},target=/restore`,
    '-e',
    'RESTIC_REPOSITORY=/repository',
    '-e',
    'RESTIC_PASSWORD_FILE=/run/secrets/pw',
    '-e',
    'HOME=/tmp',
    '-e',
    'RESTIC_CACHE_DIR=/tmp/restic-cache',
    '--entrypoint',
    'restic',
    opsImage,
    ...args,
  ]);
}
try {
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  await mkdir(path.join(root, 'coverage'), { recursive: true });
  await writeFile(
    path.join(root, 'coverage/deployment-report.json'),
    JSON.stringify(report),
  );
  if (!process.argv.includes('--skip-build')) {
    await command([
      'build',
      '-f',
      'deploy/Dockerfile',
      '--target',
      'app',
      '-t',
      appImage,
      '.',
    ]);
    await command([
      'build',
      '-f',
      'deploy/Dockerfile',
      '--target',
      'operations',
      '-t',
      opsImage,
      '.',
    ]);
  }
  const status = spawnSync(
    process.execPath,
    ['node_modules/supabase/dist/supabase.js', 'status', '--output', 'json'],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, DO_NOT_TRACK: '1' },
    },
  );
  if (status.status !== 0) throw new Error('LOCAL_SUPABASE_REQUIRED');
  const config = JSON.parse(status.stdout);
  assert.equal(config.API_URL, 'http://127.0.0.1:55321');
  assert.equal(new URL(config.DB_URL).port, '55322');
  const networks = JSON.parse(
    await command([
      'inspect',
      '--format',
      '{{json .NetworkSettings.Networks}}',
      'supabase_kong_auto-email',
    ]),
  );
  supabaseNetwork = Object.keys(networks).find(
    (name) => name === 'supabase_network_auto-email',
  );
  assert.ok(supabaseNetwork, 'Exact local Supabase network required');
  service = createClient(config.API_URL, config.SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const privacy = JSON.parse(
    await readFile(path.join(root, 'tests/fixtures/privacy-env.json'), 'utf8'),
  );
  const key = randomBytes(32).toString('base64');
  const data = {
    APP_ENV: 'test',
    PROVIDER_MODE: 'mock',
    APP_URL: origin,
    SUPABASE_URL: config.API_URL,
    SUPABASE_PUBLISHABLE_KEY: config.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: config.SECRET_KEY,
    PROVIDER_TIMEOUT_MS: '30000',
    ...privacy,
    ERASURE_LEDGER_DIRECTORY: '/var/lib/auto-email/erasures',
    ERASURE_LEDGER_ENCRYPTION_KEY: key,
    SECURITY_MAINTENANCE_MODE: 'false',
    WORKER_SCHEDULER_INTERVAL_SECONDS: '1',
    OBSERVABILITY_MONITOR_INTERVAL_SECONDS: '10',
  };
  for (const name of ['ledger', 'repository', 'staging', 'restored'])
    await mkdir(path.join(scratch, name), { mode: 0o700 });
  const erasedId = randomUUID(),
    ledger = createErasureLedger(
      path.join(scratch, 'ledger'),
      new SecretValue(key),
    );
  await ledger.initialize();
  await ledger.record(erasedId);
  for (const role of ['web', 'worker', 'monitor'])
    await writeFile(
      path.join(scratch, `${role}.json`),
      JSON.stringify(selectRuntimeConfig(role, data)),
      { mode: 0o400 },
    );
  const backupData = selectRuntimeConfig('backup', {
    ...data,
    RESTIC_REPOSITORY: '/repository',
    RESTIC_PASSWORD_FILE: '/run/secrets/backup-password',
    BACKUP_DIRECTORY: '/var/lib/auto-email/backups',
    BACKUP_RETENTION_DAYS: '30',
    PGSERVICEFILE: '/run/secrets/database.conf',
    PGSERVICE: 'local',
  });
  await writeFile(
    path.join(scratch, 'backup.json'),
    JSON.stringify(backupData),
    { mode: 0o400 },
  );
  await writeFile(
    path.join(scratch, 'backup-password'),
    randomBytes(32).toString('base64'),
    { mode: 0o400 },
  );
  await writeFile(
    path.join(scratch, 'database.conf'),
    `[local]\nhost=supabase_db_auto-email\nport=5432\ndbname=postgres\nuser=postgres\npassword=${decodeURIComponent(new URL(config.DB_URL).password)}\nsslmode=disable\n`,
    { mode: 0o400 },
  );
  await ownedByContainer([
    'ledger',
    'repository',
    'staging',
    'restored',
    'web.json',
    'worker.json',
    'monitor.json',
    'backup.json',
    'database.conf',
    'backup-password',
  ]);
  report.phase = 'web-health';
  const web = await runService('web', { port });
  assert.equal((await fetch(`${origin}/api/health/live`)).status, 200);
  assert.equal((await fetch(`${origin}/api/health/ready`)).status, 200);
  assert.equal((await fetch(`${origin}/api/account`)).status, 401);
  assert.match(await (await fetch(`${origin}/login`)).text(), /Iniciar sesión/);
  report.containerHealth = true;
  const email = `mail067-${suffix}@example.invalid`,
    password = `Synthetic-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  const owner = created.data.user.id;
  users.push(owner);
  const notice = readPrivacyNotice(privacy);
  assert.equal(notice.ready, true);
  assert.equal(
    (
      await service.rpc('grant_privacy_authorization', {
        p_user_id: owner,
        p_version: notice.version,
        p_notice_hash: notice.hash,
        p_notice_text: notice.snapshot,
      })
    ).error,
    null,
  );
  const jar = new Map();
  const auth = createAuthClient(
    {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) =>
        cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
    {
      appOrigin: origin,
      supabaseUrl: config.API_URL,
      publishableKey: config.PUBLISHABLE_KEY,
      secureCookies: false,
    },
  );
  assert.equal(
    (await auth.auth.signInWithPassword({ email, password })).error,
    null,
  );
  const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const content = 'Synthetic deployment document. Price Atlas: 125 euros.';
  const form = new FormData();
  form.set(
    'file',
    new File([content], 'deployment.txt', { type: 'text/plain' }),
  );
  report.phase = 'authenticated-upload';
  const upload = await fetch(`${origin}/api/knowledge/documents`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  assert.equal(
    upload.status,
    201,
    'Standalone image must include the document parser and dependencies',
  );
  const document = (await upload.json()).document;
  report.authenticatedUpload = true;
  report.phase = 'process-recovery';
  const worker = await runService('worker');
  await runService('monitor');
  await eventually(
    async () =>
      (
        await service
          .from('operational_runs')
          .select('id')
          .eq('stage', 'WORKER')
          .eq('status', 'SUCCEEDED')
          .limit(1)
      ).data?.length > 0,
  );
  report.phase = 'worker-restart';
  await crashService(worker);
  await eventually(
    async () =>
      Number(
        await command(['inspect', '--format', '{{.RestartCount}}', worker]),
      ) >= 1 &&
      (await command([
        'inspect',
        '--format',
        '{{.State.Health.Status}}',
        worker,
      ])) === 'healthy',
  );
  report.workerRestart = true;
  report.phase = 'web-restart';
  await crashService(web);
  await eventually(async () => (await fetch(`${origin}/api/health/ready`)).ok);
  report.webRestart = true;
  assert.equal(
    (await fetch(`${origin}/api/account`, { headers: { Cookie: cookie } }))
      .status,
    200,
  );
  for (const container of containers)
    await command(['stop', '--time', '30', container]);
  report.phase = 'encrypted-backup';
  await backup('init');
  await backup('create');
  await backup('verify');
  const snapshots = JSON.parse(
    await restic(['snapshots', '--json', '--tag', 'auto-email']),
  );
  assert.equal(snapshots.length, 1);
  const exported = JSON.parse(await backup('export', snapshots[0].id));
  assert.equal(exported.exported, true);
  report.encryptedBackupVerified = true;
  report.backupExport = true;
  await ownedByContainer(
    ['staging'],
    process.getuid?.() ?? 1000,
    process.getgid?.() ?? 1000,
  );
  assert.ok(exported.directory.startsWith('/var/lib/auto-email/backups/'));
  const restored = path.join(
    scratch,
    'staging',
    exported.directory.slice('/var/lib/auto-email/backups/'.length),
  );
  const files = JSON.parse(
    await readFile(path.join(restored, 'manifest.json'), 'utf8'),
  ).files;
  assert.ok(
    files.some((file) => file.path === `storage/${owner}/${document.id}`),
  );
  assert.equal(
    createHash('sha256')
      .update(
        await readFile(path.join(restored, 'storage', owner, document.id)),
      )
      .digest('hex'),
    createHash('sha256').update(content).digest('hex'),
  );
  report.storageIntegrity = true;
  assert.equal(
    await createErasureLedger(
      path.join(restored, 'ledger'),
      new SecretValue(key),
    ).has(erasedId),
    true,
  );
  report.erasureLedgerDecrypted = true;
  report.phase = 'database-restoration';
  await command([
    'cp',
    path.join(restored, 'database.dump'),
    `supabase_db_auto-email:/tmp/${database}.dump`,
  ]);
  await command([
    'exec',
    'supabase_db_auto-email',
    'createdb',
    '-U',
    'postgres',
    database,
  ]);
  databaseCreated = true;
  await command([
    'exec',
    'supabase_db_auto-email',
    'psql',
    '-U',
    'postgres',
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'drop schema public cascade; create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions; create extension pg_jsonschema with schema extensions;',
  ]);
  await command([
    'exec',
    'supabase_db_auto-email',
    'pg_restore',
    '--exit-on-error',
    '--no-owner',
    '-U',
    'supabase_admin',
    '-d',
    database,
    `/tmp/${database}.dump`,
  ]);
  const verified = await command([
    'exec',
    'supabase_db_auto-email',
    'psql',
    '-U',
    'postgres',
    '-d',
    database,
    '-tAc',
    `select (select count(*) from public.users where id='${owner}')=1 and (select count(*) from public.source_documents where id='${document.id}')=1 and not has_table_privilege('anon','public.operational_alerts','SELECT');`,
  ]);
  assert.equal(verified.trim(), 't');
  report.databaseRestored = true;
  report.passed = true;
  report.phase = 'complete';
  console.log(
    'MAIL-067: imágenes, salud, acceso, parser, reinicios, backup cifrado y restauración de base/Storage/registro: OK.',
  );
} finally {
  for (const name of containers.reverse())
    await command(['rm', '--force', name]).catch(() => {});
  if (databaseCreated)
    await command([
      'exec',
      'supabase_db_auto-email',
      'dropdb',
      '-U',
      'postgres',
      database,
    ]).catch(() => {});
  await command([
    'exec',
    'supabase_db_auto-email',
    'rm',
    '-f',
    `/tmp/${database}.dump`,
  ]).catch(() => {});
  for (const owner of users) {
    const documents = await service
      .from('source_documents')
      .select('id')
      .eq('user_id', owner);
    if (documents.data?.length)
      await service.storage
        .from('knowledge-documents')
        .remove(documents.data.map((d) => `${owner}/${d.id}`));
    await service.from('source_rules').delete().eq('user_id', owner);
    await service.from('source_documents').delete().eq('user_id', owner);
    await service.auth.admin.deleteUser(owner);
  }
  if ((await lstat(scratch).catch(() => null))?.isDirectory()) {
    await ownedByContainer(
      [
        'ledger',
        'repository',
        'staging',
        'restored',
        'web.json',
        'worker.json',
        'monitor.json',
        'backup.json',
        'database.conf',
        'backup-password',
      ],
      process.getuid?.() ?? 1000,
      process.getgid?.() ?? 1000,
    ).catch(() => {});
    assert.ok(
      path.resolve(scratch).startsWith(path.join(root, '.cache') + path.sep),
    );
    await rm(scratch, { recursive: true, force: true });
  }
  await writeFile(
    path.join(root, 'coverage/deployment-report.json'),
    JSON.stringify(report, null, 2),
  );
}
