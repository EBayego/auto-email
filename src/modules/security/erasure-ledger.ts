import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  open,
  readFile,
  readdir,
  lstat,
  mkdir,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ConfigurationError, SecretValue } from '@/config/env';

const recordSchema = z.strictObject({
  version: z.literal(1),
  userId: z.uuid(),
  requestedAt: z.iso.datetime(),
});
const aad = Buffer.from('auto-email:erasure-ledger:v1');
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export class SecurityStateError extends Error {
  constructor(
    public readonly code:
      | 'SECURITY_MAINTENANCE'
      | 'ACCOUNT_ERASED'
      | 'ERASURE_LEDGER_UNAVAILABLE'
      | 'RESTORE_REPLAY_INCOMPLETE',
  ) {
    super(code);
    this.name = 'SecurityStateError';
  }
}
export function createErasureLedger(directory: string, key: SecretValue) {
  if (
    !path.isAbsolute(directory) ||
    Buffer.from(key.reveal(), 'base64').length !== 32
  )
    throw new ConfigurationError([
      'ERASURE_LEDGER_DIRECTORY',
      'ERASURE_LEDGER_ENCRYPTION_KEY',
    ]);
  const filename = (userId: string) => {
    if (!z.uuid().safeParse(userId).success)
      throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
    return `${createHash('sha256').update(userId).digest('hex')}.erasure`;
  };
  const marker = createHmac('sha256', Buffer.from(key.reveal(), 'base64'))
    .update('auto-email:erasure-ledger:directory:v1')
    .digest('hex');
  const ready = async () => {
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
      const manifest = path.join(directory, '.ledger');
      const info = await lstat(manifest);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== 64 ||
        (await readFile(manifest, 'utf8')) !== marker
      )
        throw new Error();
    } catch {
      throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
    }
  };
  const read = async (name: string) => {
    try {
      const file = path.join(directory, name),
        stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048)
        throw new Error();
      const bytes = await readFile(file);
      if (bytes.length < 30 || bytes[0] !== 1) throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(key.reveal(), 'base64'),
        bytes.subarray(1, 13),
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(13, 29));
      const record = recordSchema.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(bytes.subarray(29)),
            decipher.final(),
          ]).toString('utf8'),
        ),
      );
      if (filename(record.userId) !== name) throw new Error();
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
    }
  };
  return Object.freeze({
    verify: ready,
    async initialize() {
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
        const handle = await open(path.join(directory, '.ledger'), 'wx', 0o600);
        try {
          await handle.writeFile(marker);
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
          throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
      }
      await ready();
      await syncDirectory(directory);
    },
    async has(userId: string) {
      await ready();
      return !!(await read(filename(userId)));
    },
    async record(userId: string) {
      await ready();
      const name = filename(userId);
      if (await read(name)) return;
      const record = recordSchema.parse({
        version: 1,
        userId,
        requestedAt: new Date().toISOString(),
      });
      const nonce = randomBytes(12),
        cipher = createCipheriv(
          'aes-256-gcm',
          Buffer.from(key.reveal(), 'base64'),
          nonce,
        );
      cipher.setAAD(aad);
      const body = Buffer.concat([
        cipher.update(JSON.stringify(record), 'utf8'),
        cipher.final(),
      ]);
      const bytes = Buffer.concat([
        Buffer.from([1]),
        nonce,
        cipher.getAuthTag(),
        body,
      ]);
      const temp = path.join(directory, `${randomUUID()}.tmp`);
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
        const handle = await open(temp, 'wx', 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temp, path.join(directory, name));
        await syncDirectory(directory);
      } catch {
        throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
      } finally {
        await unlink(temp).catch(() => undefined);
      }
    },
    async entries() {
      await ready();
      try {
        const names = await readdir(directory);
        const records = [];
        for (const name of names)
          if (/^[a-f0-9]{64}\.erasure$/.test(name)) {
            const record = await read(name);
            if (!record) throw new Error();
            records.push(record);
          }
        return records;
      } catch {
        throw new SecurityStateError('ERASURE_LEDGER_UNAVAILABLE');
      }
    },
  });
}
export function getErasureLedger(
  env: Record<string, string | undefined> = process.env,
) {
  const directory = env.ERASURE_LEDGER_DIRECTORY,
    key = env.ERASURE_LEDGER_ENCRYPTION_KEY;
  if (env.APP_ENV === 'test' && !directory && !key) return null;
  const failures = [];
  if (!directory || !path.isAbsolute(directory))
    failures.push('ERASURE_LEDGER_DIRECTORY');
  if (
    !key ||
    !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
    Buffer.from(key, 'base64').toString('base64') !== key
  )
    failures.push('ERASURE_LEDGER_ENCRYPTION_KEY');
  if (failures.length) throw new ConfigurationError(failures);
  return createErasureLedger(directory!, new SecretValue(key!));
}
export async function assertAccountNotErased(userId: string) {
  if (process.env.SECURITY_MAINTENANCE_MODE === 'true')
    throw new SecurityStateError('SECURITY_MAINTENANCE');
  if (await getErasureLedger()?.has(userId))
    throw new SecurityStateError('ACCOUNT_ERASED');
}
