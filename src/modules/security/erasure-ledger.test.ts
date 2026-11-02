import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { SecretValue } from '@/config/env';
import { createErasureLedger, assertAccountNotErased } from './erasure-ledger';

const directories: string[] = [];
const key = new SecretValue(Buffer.alloc(32, 62).toString('base64'));
async function fixture() {
  const cache = path.resolve('.cache');
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(path.join(cache, 'auto-email-erasure-'));
  directories.push(directory);
  const ledger = createErasureLedger(directory, key);
  await ledger.initialize();
  return { directory, ledger };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== path.resolve('.cache') ||
      !path.basename(resolved).startsWith('auto-email-erasure-')
    )
      throw new Error('Invalid cleanup');
    await rm(resolved, { recursive: true, force: true });
  }
});
describe('MAIL-062 registro externo cifrado de supresiones', () => {
  it('guarda solo UUID y fecha, con cifrado autenticado e inicialización idempotente', async () => {
    const { directory, ledger } = await fixture(),
      userId = crypto.randomUUID();
    await ledger.record(userId);
    await ledger.record(userId);
    await ledger.initialize();
    expect(await ledger.has(userId)).toBe(true);
    expect(await ledger.has(crypto.randomUUID())).toBe(false);
    const names = (await readdir(directory)).filter((n) =>
      n.endsWith('.erasure'),
    );
    expect(names).toHaveLength(1);
    expect(names[0]).not.toContain(userId);
    expect(
      (await readFile(path.join(directory, names[0]))).toString(),
    ).not.toContain(userId);
    const records = await ledger.entries();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      version: 1,
      userId,
      requestedAt: expect.any(String),
    });
  });
  it('la pérdida del registro o una clave equivocada cierra el acceso en vez de asumir que no hay borrados', async () => {
    const { directory, ledger } = await fixture();
    const wrong = createErasureLedger(
      directory,
      new SecretValue(Buffer.alloc(32, 63).toString('base64')),
    );
    await expect(wrong.has(crypto.randomUUID())).rejects.toThrow(
      'ERASURE_LEDGER_UNAVAILABLE',
    );
    await expect(wrong.initialize()).rejects.toThrow(
      'ERASURE_LEDGER_UNAVAILABLE',
    );
    await unlink(path.join(directory, '.ledger'));
    await expect(ledger.entries()).rejects.toThrow(
      'ERASURE_LEDGER_UNAVAILABLE',
    );
    await expect(ledger.has(crypto.randomUUID())).rejects.toThrow(
      'ERASURE_LEDGER_UNAVAILABLE',
    );
  });
  it('detecta corrupción del contenido sin exponerlo en el error', async () => {
    const { directory, ledger } = await fixture(),
      userId = crypto.randomUUID();
    await ledger.record(userId);
    const name = (await readdir(directory)).find((n) =>
      n.endsWith('.erasure'),
    )!;
    const bytes = await readFile(path.join(directory, name));
    bytes[bytes.length - 1] ^= 1;
    await writeFile(path.join(directory, name), bytes);
    await expect(ledger.has(userId)).rejects.toThrow(
      'ERASURE_LEDGER_UNAVAILABLE',
    );
  });
  it('la supresión sigue bloqueando una identidad aunque una copia restaure su estado ACTIVE', async () => {
    const { directory, ledger } = await fixture(),
      userId = crypto.randomUUID();
    await ledger.record(userId);
    vi.stubEnv('ERASURE_LEDGER_DIRECTORY', directory);
    vi.stubEnv('ERASURE_LEDGER_ENCRYPTION_KEY', key.reveal());
    await expect(assertAccountNotErased(userId)).rejects.toMatchObject({
      code: 'ACCOUNT_ERASED',
    });
    await expect(
      assertAccountNotErased(crypto.randomUUID()),
    ).resolves.toBeUndefined();
    vi.stubEnv('SECURITY_MAINTENANCE_MODE', 'true');
    await expect(
      assertAccountNotErased(crypto.randomUUID()),
    ).rejects.toMatchObject({ code: 'SECURITY_MAINTENANCE' });
  });
});
