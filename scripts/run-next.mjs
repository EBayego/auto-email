import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ConfigurationError } from '../src/config/env.ts';
import { validateEnvironment } from './check-env.mjs';

const command = process.argv[2];
if (!['dev', 'start'].includes(command))
  throw new Error('Comando no admitido.');
process.env.NODE_ENV ??= command === 'dev' ? 'development' : 'production';
try {
  validateEnvironment(command === 'dev');
} catch (error) {
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : 'No se pudo cargar la configuración del servidor.',
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL('../node_modules/next/dist/bin/next', import.meta.url),
    ),
    command,
    ...process.argv.slice(3),
  ],
  { stdio: 'inherit', env: process.env, windowsHide: true },
);
child.once('error', () => {
  console.error('No se pudo arrancar Next.js.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
