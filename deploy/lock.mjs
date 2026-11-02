import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
export async function withDeploymentLock(directory, operation) {
  const file = path.join(path.resolve(directory), '.auto-email-operation.lock');
  const handle = await open(file, 'wx', 0o600).catch(() => {
    throw new Error('DEPLOYMENT_OPERATION_ALREADY_RUNNING');
  });
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
    );
    return await operation();
  } finally {
    await handle.close();
    await unlink(file);
  }
}
