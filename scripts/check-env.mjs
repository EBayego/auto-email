import nextEnvironment from '@next/env';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ConfigurationError, readServerConfig } from '../src/config/env.ts';
const { loadEnvConfig } = nextEnvironment;

export function validateEnvironment(
  development = process.env.NODE_ENV !== 'production',
) {
  loadEnvConfig(process.cwd(), development, {
    info() {},
    error() {
      throw new Error('ENV_FILE');
    },
  });
  return readServerConfig();
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const config = validateEnvironment();
    console.log(
      `Configuración válida: ${config.environment}, proveedores ${config.providerMode}.`,
    );
  } catch (error) {
    console.error(
      error instanceof ConfigurationError
        ? error.message
        : 'No se pudo cargar la configuración del servidor.',
    );
    process.exitCode = 1;
  }
}
