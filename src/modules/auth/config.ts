import { readAuthConfig, type AuthConfig } from '@/config/env';
export type { AuthConfig } from '@/config/env';

export function getAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  try {
    return readAuthConfig(env);
  } catch {
    throw new Error('Configuración de autenticación incompleta o inválida.');
  }
}

export function isAuthConfigured(): boolean {
  try {
    getAuthConfig();
    return true;
  } catch {
    return false;
  }
}
