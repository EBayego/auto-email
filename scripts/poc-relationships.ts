import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { getServerConfig, ConfigurationError } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { createStyleRelationshipRepository } from '../src/db/style-relationships';
import { DataAccessError } from '../src/db/errors';
import {
  ContextualStyleError,
  normalizeStyleScope,
  validateRelationshipRule,
  type RelationshipCategory,
} from '../src/modules/identity/contextual-style';

export const usage = `MAIL-025 — Categorías de relación asignadas explícitamente por el titular.
Uso: npm run poc:relationships -- --email CUENTA [opciones]
  --list                   Muestra las asignaciones de esta cuenta.
  --recipient EMAIL | --domain DOMINIO
  --category CLIENT|COLLEAGUE|SUPPLIER|MANAGEMENT|OTHER
                           Asigna cliente, compañero, proveedor, dirección u otros.
  --remove                 Retira la asignación seleccionada.
  --help                   Muestra esta ayuda.
Un contacto explícito tiene prioridad sobre el dominio. Cambiar asignaciones invalida los perfiles de categoría; usa poc:style --contexts para reconstruirlos.`;
export function parseRelationshipArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      recipient: { type: 'string' },
      domain: { type: 'string' },
      category: { type: 'string' },
      remove: { type: 'boolean' },
      list: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  if (
    !values.email ||
    !/^[^\s<>@]+@[^\s<>@]+$/u.test(values.email) ||
    values.email.length > 254
  )
    throw new DataAccessError('INVALID_INPUT');
  if (values.list) {
    if (
      values.recipient !== undefined ||
      values.domain !== undefined ||
      values.category !== undefined ||
      values.remove
    )
      throw new DataAccessError('INVALID_INPUT');
    return { action: 'list' as const, email: values.email.toLowerCase() };
  }
  if (
    Number(values.recipient !== undefined) +
      Number(values.domain !== undefined) !==
      1 ||
    !!values.remove === (values.category !== undefined)
  )
    throw new DataAccessError('INVALID_INPUT');
  const target = normalizeStyleScope(
    values.recipient !== undefined
      ? { kind: 'RECIPIENT', key: values.recipient }
      : { kind: 'DOMAIN', key: values.domain },
  );
  if (target.kind !== 'RECIPIENT' && target.kind !== 'DOMAIN')
    throw new DataAccessError('INVALID_INPUT');
  const rule = values.remove
    ? null
    : validateRelationshipRule({
        ...target,
        category: values.category!.toUpperCase() as RelationshipCategory,
      });
  return {
    action: values.remove ? ('remove' as const) : ('set' as const),
    email: values.email.toLowerCase(),
    target,
    rule,
  };
}
export async function main(args = process.argv.slice(2)) {
  const options = parseRelationshipArgs(args);
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
  const repo = createStyleRelationshipRepository(
    client,
    work.userId,
    work.gmailAccountId,
  );
  if (options.action === 'list') {
    console.log(JSON.stringify(await repo.list(), null, 2));
    return;
  }
  if (options.action === 'set') await repo.set(options.rule!);
  else await repo.remove(options.target);
  console.log(JSON.stringify({ action: options.action, updated: true }));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    const code =
      error instanceof DataAccessError || error instanceof ContextualStyleError
        ? error.code
        : error instanceof ConfigurationError
          ? error.message
          : 'UNAVAILABLE';
    console.error(`No se pudo configurar la relación: ${code}. Usa --help.`);
    process.exitCode = 1;
  });
