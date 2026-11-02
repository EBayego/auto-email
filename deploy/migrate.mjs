import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const project = JSON.parse(
  await readFile(new URL('../supabase/project.json', import.meta.url), 'utf8'),
);
if (
  project.projectRef !== 'zbcexekelujsqkkynsog' ||
  !process.env.SUPABASE_ACCESS_TOKEN ||
  !process.env.SUPABASE_DB_PASSWORD
)
  throw new Error('MIGRATION_CONFIGURATION_REQUIRED');
// Pass no database URL/password through argv and never seed production.
const child = spawn(
  process.execPath,
  [
    'node_modules/supabase/dist/supabase.js',
    'db',
    'push',
    '--project-ref',
    project.projectRef,
    '--skip-vault',
    '--yes',
  ],
  {
    env: { ...process.env, DO_NOT_TRACK: '1' },
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
