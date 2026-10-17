import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertBusinessChangesHaveTests(changes) {
  const business = changes.filter(
    ({ path }) =>
      !/\.(test|integration)\./.test(path) &&
      path !== 'src/db/database.types.ts' &&
      (/^src\/(modules|providers|worker|db|config)\/.*\.[cm]?tsx?$/.test(
        path,
      ) ||
        /^src\/app\/(?:.*\/)?(route|actions)\.ts$/.test(path) ||
        /^src\/app\/_lib\/.*\.ts$/.test(path) ||
        path === 'src/proxy.ts' ||
        /^supabase\/migrations\/.*\.sql$/.test(path)),
  );
  const updatedTests = changes.some(
    ({ status, path }) =>
      status !== 'D' &&
      (/^(src|tests)\/.*\.(test|integration)\.[cm]?[jt]sx?$/.test(path) ||
        /^supabase\/tests\/.*\.test\.sql$/.test(path)),
  );
  if (business.length && !updatedTests)
    throw new Error(
      'Los cambios de lógica de negocio deben incluir pruebas nuevas o actualizadas de sus casos relevantes.',
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const base = process.env.TEST_BASE_REF || process.argv[2];
    if (!base || !/^[a-f\d]{40}$/i.test(base))
      throw new Error('Indica el SHA base de la PR mediante TEST_BASE_REF.');
    const fields = execFileSync(
      'git',
      ['diff', '--name-status', '--no-renames', '-z', `${base}...HEAD`],
      { encoding: 'utf8', windowsHide: true },
    )
      .split('\0')
      .filter(Boolean);
    const changes = [];
    for (let i = 0; i < fields.length; i += 2)
      changes.push({ status: fields[i], path: fields[i + 1] });
    assertBusinessChangesHaveTests(changes);
    console.log('Regla de pruebas para cambios de negocio verificada.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
