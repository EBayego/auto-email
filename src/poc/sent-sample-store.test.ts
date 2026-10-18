import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareSentSample } from '@/modules/identity/sent-sample';
import {
  sampleNow,
  sampleOwner,
  sentEmail,
  sentMailbox,
} from '../../tests/fixtures/sent-emails';
import { createSentSampleStore } from './sent-sample-store';

const work = {
  userId: '00000000-0000-4000-8000-000000000001',
  gmailAccountId: '00000000-0000-4000-8000-000000000002',
};
describe('persistencia local minimizada de MAIL-017', () => {
  let directory: string;
  beforeEach(async () => {
    const base = resolve('.cache');
    await mkdir(base, { recursive: true });
    directory = await mkdtemp(join(base, 'mail017-test-'));
  });
  afterEach(async () => {
    // Only individual files in the known test directory are removed.
    for (const file of await readdir(directory))
      await unlink(join(directory, file));
    await rmdir(directory);
  });
  const manifest = () =>
    prepareSentSample(
      sentMailbox([sentEmail(0)]),
      { mailboxAddress: sampleOwner },
      undefined,
      sampleNow,
    );
  it('guarda únicamente referencias y métricas aunque el objeto recibido contenga textos adicionales', async () => {
    const store = createSentSampleStore(directory);
    const sample = await manifest();
    Object.assign(sample, {
      body: 'private-body',
      subject: 'private-subject',
      token: 'private-token',
    });
    Object.assign(sample.sourceMessages[0], {
      authoredText: 'private-example',
    });
    Object.assign(sample.statistics, {
      recipients: ['private@example.invalid'],
    });
    const path = await store.save(work, sample, sampleNow);
    expect(await readFile(path, 'utf8')).not.toContain('private');
    expect(await store.load(work, sampleNow)).toMatchObject({
      ...work,
      sourceMessages: [{ id: 'sent0', threadId: 'thread0' }],
    });
    await store.save(work, await manifest(), sampleNow);
    expect(await readdir(directory)).toHaveLength(1);
  });
  it('caduca las referencias a los 90 días y las purga al consultar o ejecutar mantenimiento', async () => {
    const store = createSentSampleStore(directory);
    const sample = await manifest();
    await store.save(work, sample, sampleNow);
    expect(await store.purgeExpired(new Date(sample.expiresAt))).toBe(1);
    expect(await store.load(work, sampleNow)).toBeNull();
    await store.save(work, sample, sampleNow);
    expect(await store.load(work, new Date(sample.expiresAt))).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });
  it('no consulta muestras de otra cuenta y permite eliminar las referencias propias', async () => {
    const store = createSentSampleStore(directory);
    await store.save(work, await manifest(), sampleNow);
    expect(
      await store.load(
        { ...work, userId: '00000000-0000-4000-8000-000000000003' },
        sampleNow,
      ),
    ).toBeNull();
    await store.remove(work);
    await store.remove(work);
    expect(await readdir(directory)).toEqual([]);
    await expect(
      store.load({ ...work, gmailAccountId: '../escape' }, sampleNow),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('rechaza cambios de propietario, plazos superiores al límite y archivos manipulados', async () => {
    const store = createSentSampleStore(directory);
    const sample = await manifest();
    await expect(
      store.save(work, { ...sample, expiresAt: '2028-01-01' }, sampleNow),
    ).rejects.toThrow('INVALID_SAMPLE_MANIFEST');
    const path = await store.save(work, sample, sampleNow);
    const json = JSON.parse(await readFile(path, 'utf8'));
    json.userId = '00000000-0000-4000-8000-000000000003';
    await writeFile(path, JSON.stringify(json));
    await expect(store.load(work, sampleNow)).rejects.toThrow(
      'SAMPLE_OWNER_MISMATCH',
    );
  });
});
