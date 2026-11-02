import { spawn } from 'node:child_process';
import { testProcessEnvironment, vitestPath } from './test-environment.mjs';
const args = process.argv.slice(2);
const child = spawn(
  process.execPath,
  [vitestPath, ...(args.includes('--watch') ? [] : ['run']), ...args],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: testProcessEnvironment({ AUTO_EMAIL_TEST_NETWORK_MODE: 'unit' }),
  },
);
child.once('error', () => {
  console.error('No se pudo arrancar la suite unitaria.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
