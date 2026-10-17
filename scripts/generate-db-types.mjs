import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const supabaseRoot = path.join(root, 'node_modules', 'supabase');
const metadata = JSON.parse(
  readFileSync(path.join(supabaseRoot, 'package.json'), 'utf8'),
);
const cli = path.join(supabaseRoot, metadata.bin.supabase);
const result = spawnSync(
  process.execPath,
  [cli, 'gen', 'types', 'typescript', '--local', '--schema', 'public'],
  { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'No se pudieron generar los tipos.\n');
  process.exit(result.status ?? 1);
}
if (!result.stdout.includes('export type Database')) {
  console.error('La CLI no ha devuelto un esquema TypeScript válido.');
  process.exit(1);
}

const target = path.join(root, 'src', 'db', 'database.types.ts');
const temporaryTarget = `${target}.tmp`;
writeFileSync(temporaryTarget, result.stdout, 'utf8');
renameSync(temporaryTarget, target);
console.log(
  'Tipos regenerados desde el esquema local validado. Ejecuta npm run format.',
);
