import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
  lstat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireUuid } from '@/db/errors';
import type { OwnedWorkItem } from '@/worker/data-access';
import type { SentSampleManifest } from '@/modules/identity/sent-sample';

const maxAgeMs = 90 * 86400000;
type StoredSample = SentSampleManifest & OwnedWorkItem;
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);

// Allowlist serialization even if a future caller adds raw text to its runtime object.
function minimal(sample: StoredSample): StoredSample {
  requireUuid(sample.userId);
  requireUuid(sample.gmailAccountId);
  const { statistics: s } = sample;
  const created = Date.parse(sample.createdAt);
  const expires = Date.parse(sample.expiresAt);
  if (
    sample.version !== 1 ||
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    expires <= created ||
    expires - created > maxAgeMs ||
    !Array.isArray(sample.sourceMessages) ||
    sample.sourceMessages.length > 500 ||
    sample.sourceMessages.some((ref) => !id(ref.id) || !id(ref.threadId)) ||
    !s ||
    s.selected !== sample.sourceMessages.length
  )
    throw new Error('INVALID_SAMPLE_MANIFEST');
  const counts = (value: object, keys: readonly string[]) =>
    Object.fromEntries(
      keys.map((key) => {
        const count = (value as Record<string, unknown>)[key];
        if (
          typeof count !== 'number' ||
          !Number.isSafeInteger(count) ||
          count < 0
        )
          throw new Error('INVALID_SAMPLE_MANIFEST');
        return [key, count];
      }),
    );
  const numbers = counts(s, [
    'scanned',
    'bodiesRead',
    'eligible',
    'selected',
    'uniqueRecipients',
    'uniqueThreads',
    'htmlMessages',
    'averageWords',
  ]);
  if (
    !Array.isArray(s.quarters) ||
    s.quarters.length !== 4 ||
    s.quarters.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    ![s.oldestAt, s.newestAt].every(
      (date) => date === null || Number.isFinite(Date.parse(date)),
    ) ||
    !Number.isFinite(Date.parse(sample.window.after)) ||
    !Number.isFinite(Date.parse(sample.window.before)) ||
    !Number.isInteger(sample.targetSize) ||
    sample.targetSize < 200 ||
    sample.targetSize > 500 ||
    !Array.isArray(sample.warnings) ||
    sample.warnings.some(
      (warning) =>
        !['BELOW_RECOMMENDED_SIZE', 'SCAN_LIMIT_REACHED'].includes(warning),
    )
  )
    throw new Error('INVALID_SAMPLE_MANIFEST');
  return {
    version: 1,
    userId: sample.userId,
    gmailAccountId: sample.gmailAccountId,
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    window: {
      after: new Date(sample.window.after).toISOString(),
      before: new Date(sample.window.before).toISOString(),
    },
    targetSize: sample.targetSize,
    sourceMessages: sample.sourceMessages.map((ref) => ({
      id: ref.id,
      threadId: ref.threadId,
    })),
    statistics: {
      ...numbers,
      excluded: counts(s.excluded, [
        'NOT_SENT',
        'EXCLUDED_LABEL',
        'EXCLUDED_CONTACT',
        'AUTOMATED',
        'FORWARDED',
        'UNTRUSTED_AUTHOR',
        'OUTSIDE_WINDOW',
        'INVALID_MESSAGE',
        'INCOMPLETE_BODY',
        'TOO_SHORT',
        'TOO_LARGE',
        'DUPLICATE_CONTENT',
      ]),
      lengths: counts(s.lengths, ['short', 'medium', 'long']),
      kinds: counts(s.kinds, ['reply', 'new']),
      quarters: [...s.quarters],
      oldestAt: s.oldestAt,
      newestAt: s.newestAt,
    } as SentSampleManifest['statistics'],
    warnings: [...sample.warnings],
  };
}

export function createSentSampleStore(directory: string) {
  const filename = (work: OwnedWorkItem) => {
    requireUuid(work.userId);
    requireUuid(work.gmailAccountId);
    return `${work.userId}_${work.gmailAccountId}.json`;
  };
  async function read(path: string) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new Error('INVALID_SAMPLE_MANIFEST');
    return minimal(JSON.parse(await readFile(path, 'utf8')));
  }
  return Object.freeze({
    async purgeExpired(now = new Date()) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      let removed = 0;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (
          !entry.isFile() ||
          !/^[a-f\d-]{36}_[a-f\d-]{36}\.json$/i.test(entry.name)
        )
          continue;
        const path = join(directory, entry.name);
        const sample = await read(path);
        if (filename(sample) !== entry.name)
          throw new Error('INVALID_SAMPLE_MANIFEST');
        if (Date.parse(sample.expiresAt) <= now.getTime()) {
          await unlink(path);
          removed++;
        }
      }
      return removed;
    },
    async save(
      work: OwnedWorkItem,
      manifest: SentSampleManifest,
      now = new Date(),
    ) {
      const sample = minimal({ ...manifest, ...work });
      if (
        Date.parse(sample.createdAt) > now.getTime() ||
        Date.parse(sample.expiresAt) <= now.getTime()
      )
        throw new Error('EXPIRED_SAMPLE');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, filename(work));
      const temp = join(directory, `${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify(sample, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
        await rename(temp, path);
      } finally {
        await unlink(temp).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      return path;
    },
    async load(
      work: OwnedWorkItem,
      now = new Date(),
    ): Promise<StoredSample | null> {
      const path = join(directory, filename(work));
      let sample: StoredSample;
      try {
        sample = await read(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      if (
        sample.userId !== work.userId ||
        sample.gmailAccountId !== work.gmailAccountId
      )
        throw new Error('SAMPLE_OWNER_MISMATCH');
      if (Date.parse(sample.expiresAt) <= now.getTime()) {
        await unlink(path);
        return null;
      }
      return sample;
    },
    async remove(work: OwnedWorkItem) {
      const path = join(directory, filename(work));
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
  });
}
