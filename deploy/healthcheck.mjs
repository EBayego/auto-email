import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export async function checkServiceHealth(
  role,
  file = '/tmp/auto-email-health.json',
  fetcher = fetch,
  now = Date.now(),
) {
  const pulse = JSON.parse(await readFile(file, 'utf8'));
  if (
    !['web', 'worker', 'monitor'].includes(role) ||
    pulse.role !== role ||
    !Number.isSafeInteger(pulse.pid) ||
    pulse.pid < 1 ||
    !Number.isSafeInteger(pulse.at) ||
    now - pulse.at > 90000 ||
    pulse.at - now > 30000
  )
    throw new Error('SERVICE_NOT_LIVE');
  if (role === 'web') {
    const response = await fetcher('http://127.0.0.1:3000/api/health/ready', {
      signal: AbortSignal.timeout(4000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  checkServiceHealth(process.argv[2]).catch(() => {
    process.exitCode = 1;
  });
