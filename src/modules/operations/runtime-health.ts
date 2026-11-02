import { writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export function startRuntimeHeartbeat(role: 'web' | 'worker' | 'monitor') {
  const file = process.env.AUTO_EMAIL_HEALTH_FILE;
  if (!file) return () => {};
  if (!path.isAbsolute(file)) throw new Error('INVALID_HEALTH_FILE');
  let pending = Promise.resolve();
  const pulse = () => {
    pending = pending
      .then(async () => {
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(
          temp,
          JSON.stringify({ role, pid: process.pid, at: Date.now() }),
          { mode: 0o600 },
        );
        await rename(temp, file);
      })
      .catch(() => {});
  };
  pulse();
  const timer = setInterval(pulse, 15000);
  timer.unref();
  return () => {
    clearInterval(timer);
    void pending.then(() => unlink(file).catch(() => {}));
  };
}
