import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { createStylePreferenceRepository } from '../src/db/style-preferences';
import { DataAccessError, requireUuid } from '../src/db/errors';
import {
  ContextualStyleError,
  normalizeStyleScope,
} from '../src/modules/identity/contextual-style';
import {
  preferenceKeys,
  preferenceOptions,
  StylePreferenceError,
  validateStylePreference,
  type StylePreference,
} from '../src/modules/identity/style-preferences';

export const usage = `MAIL-027 — Preferencias explícitas de estilo y excepciones.
Uso: npm run poc:preferences -- --email CUENTA [opciones]
  --list                     Muestra las preferencias y sus revisiones.
  --key CLAVE --value VALOR   Guarda o sustituye una preferencia.
  --key CLAVE --remove        Elimina la preferencia y recupera el estilo heredado.
  --recipient EMAIL | --domain DOMINIO | --relationship CATEGORÍA
                             Excepción; sin selector se aplica a toda la cuenta.
  --revision UUID            Edita o elimina solo si la revisión sigue vigente.
  --help                     Muestra esta ayuda.
${preferenceKeys.map((key) => `  ${key}: ${preferenceOptions[key].join('|')}`).join('\n')}
Prioridad por preferencia: destinatario, relación explícita, dominio, general.
Las preferencias siempre están subordinadas a seguridad y veracidad.`;
export function parsePreferenceArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      list: { type: 'boolean' },
      key: { type: 'string' },
      value: { type: 'string' },
      remove: { type: 'boolean' },
      recipient: { type: 'string' },
      domain: { type: 'string' },
      relationship: { type: 'string' },
      revision: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  if (
    !values.email ||
    values.email.length > 254 ||
    !/^[^\s<>@]+@[^\s<>@]+$/u.test(values.email)
  )
    throw new DataAccessError('INVALID_INPUT');
  const email = values.email.toLowerCase();
  const selectors = [
    values.recipient,
    values.domain,
    values.relationship,
  ].filter((v) => v !== undefined).length;
  if (values.list) {
    if (
      selectors ||
      values.key !== undefined ||
      values.value !== undefined ||
      values.remove ||
      values.revision !== undefined
    )
      throw new DataAccessError('INVALID_INPUT');
    return { action: 'list' as const, email };
  }
  if (
    selectors > 1 ||
    !preferenceKeys.includes(values.key as StylePreference['key']) ||
    !!values.remove === (values.value !== undefined)
  )
    throw new DataAccessError('INVALID_INPUT');
  const scope = normalizeStyleScope(
    values.recipient !== undefined
      ? { kind: 'RECIPIENT', key: values.recipient }
      : values.domain !== undefined
        ? { kind: 'DOMAIN', key: values.domain }
        : values.relationship !== undefined
          ? { kind: 'RELATIONSHIP', key: values.relationship.toUpperCase() }
          : { kind: 'GENERAL', key: '' },
  );
  if (values.revision !== undefined) requireUuid(values.revision);
  return {
    action: values.remove ? ('remove' as const) : ('set' as const),
    email,
    scope,
    key: values.key as StylePreference['key'],
    preference: values.remove
      ? null
      : validateStylePreference({
          key: values.key,
          value: values.value?.toLowerCase(),
        }),
    revision: values.revision,
  };
}
export async function main(args = process.argv.slice(2)) {
  const options = parsePreferenceArgs(args);
  if (options.action === 'help') {
    console.log(usage);
    return;
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  nextEnvironment.loadEnvConfig(root, true, {
    info() {},
    error() {
      throw new Error('ENV_FILE');
    },
  });
  const config = getServerConfig();
  if (config.environment !== 'development' || config.providerMode !== 'live')
    throw new Error('LOCAL_LIVE_ONLY');
  const client = createServiceDataClient(config);
  const { work } = await resolvePocAccount(client, options.email);
  const repo = createStylePreferenceRepository(
    client,
    work.userId,
    work.gmailAccountId,
  );
  if (options.action === 'list') {
    console.log(JSON.stringify(await repo.list(), null, 2));
    return;
  }
  if (options.action === 'set') {
    const row = await repo.set(
      { scope: options.scope, preference: options.preference! },
      options.revision,
    );
    console.log(
      JSON.stringify({ action: 'set', revision: row.revision, updated: true }),
    );
  } else {
    await repo.remove(options.scope, options.key, options.revision);
    console.log(JSON.stringify({ action: 'remove', updated: true }));
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    const code =
      error instanceof DataAccessError ||
      error instanceof StylePreferenceError ||
      error instanceof ContextualStyleError
        ? error.code
        : error instanceof ConfigurationError
          ? error.message
          : 'UNAVAILABLE';
    console.error(`No se pudo configurar la preferencia: ${code}. Usa --help.`);
    process.exitCode = 1;
  });
