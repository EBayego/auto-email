import { parseArgs } from 'node:util';
import { splitRuntimeSecrets } from './runtime-config.mjs';
const { values } = parseArgs({
  strict: true,
  allowPositionals: false,
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help)
  console.log(
    'Uso: node deploy/secrets.mjs --input /ruta/protegida/operator.json --output /ruta/protegida/nueva\nSepara secretos por proceso y no sobrescribe archivos existentes.',
  );
else if (!values.input || !values.output) {
  console.error('SECRETS_PATHS_REQUIRED');
  process.exitCode = 1;
} else
  await splitRuntimeSecrets(values.input, values.output)
    .then(() =>
      console.log(
        'Secretos separados por proceso. Revisa propietario UID 10001 y permisos 0400.',
      ),
    )
    .catch(() => {
      console.error('SECRETS_GENERATION_FAILED');
      process.exitCode = 1;
    });
