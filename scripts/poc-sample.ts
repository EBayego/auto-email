import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { DataAccessError } from '../src/db/errors';
import { createWorkerRuntime } from '../src/worker/runtime';
import { GmailCredentialError } from '../src/modules/gmail/credentials';
import { ProviderError } from '../src/providers/errors';
import {
  prepareSentSample,
  resolveSentSampleOptions,
  SentSampleError,
  type SentSampleOptions,
} from '../src/modules/identity/sent-sample';
import { createSentSampleStore } from '../src/poc/sent-sample-store';

export const usage = `MAIL-017 — Muestra local de enviados (solo lectura de Gmail).
Uso: npm run poc:sample -- --email cuenta@gmail.com [opciones]
  --size 200                  Objetivo entre 200 y 500 mensajes útiles.
  --max-candidates 500         Límite total de mensajes examinados (máximo 500).
  --after 2025-10-18           Inicio incluido; por defecto, hace 12 meses.
  --before 2026-10-18          Fin excluido; por defecto, ahora (fechas en UTC).
  --exclude-label ID          Excluir etiqueta/categoría Gmail; repetible.
  --exclude-address EMAIL     Excluir participantes; repetible.
  --exclude-domain DOMINIO    Excluir dominio y subdominios; repetible.
  --alias EMAIL               Alias propio confirmado por el operador; repetible.
  --delete                    Eliminar las referencias locales de esta cuenta.
  --purge                     Purgar referencias caducadas sin consultar Gmail.
  --help                      Mostrar esta ayuda.
Se conservan únicamente IDs y estadísticas en .cache/poc/sent-samples, hasta
90 días. Cada ejecución purga caducados y reemplaza la muestra de esa cuenta.
Los cuerpos solo se procesan en memoria. No se llama a OpenAI.`;

export function parseSampleArgs(args: string[], now = new Date()) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      size: { type: 'string' },
      'max-candidates': { type: 'string' },
      after: { type: 'string' },
      before: { type: 'string' },
      alias: { type: 'string', multiple: true },
      'exclude-label': { type: 'string', multiple: true },
      'exclude-address': { type: 'string', multiple: true },
      'exclude-domain': { type: 'string', multiple: true },
      delete: { type: 'boolean' },
      purge: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  if (values.purge) {
    if (Object.keys(values).length !== 1)
      throw new SentSampleError('INVALID_INPUT');
    return { action: 'purge' as const };
  }
  if (!values.email) throw new SentSampleError('INVALID_INPUT');
  const date = (value: string | undefined) => {
    if (value === undefined) return undefined;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      throw new SentSampleError('INVALID_INPUT');
    return new Date(value);
  };
  const options: SentSampleOptions = {
    mailboxAddress: values.email.toLowerCase(),
    aliases: values.alias,
    targetSize: values.size === undefined ? undefined : Number(values.size),
    maxCandidates:
      values['max-candidates'] === undefined
        ? undefined
        : Number(values['max-candidates']),
    after: date(values.after),
    before: date(values.before),
    excludedLabelIds: values['exclude-label'],
    excludedAddresses: values['exclude-address'],
    excludedDomains: values['exclude-domain'],
  };
  resolveSentSampleOptions(options, now);
  return {
    action: values.delete ? ('delete' as const) : ('sample' as const),
    options,
  };
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseSampleArgs(args);
  if (parsed.action === 'help') {
    console.log(usage);
    return;
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const store = createSentSampleStore(resolve(root, '.cache/poc/sent-samples'));
  const purged = await store.purgeExpired();
  if (parsed.action === 'purge') {
    console.log(`Referencias caducadas eliminadas: ${purged}.`);
    return;
  }
  nextEnvironment.loadEnvConfig(root, true, {
    info() {},
    error() {
      throw new Error('ENV_FILE');
    },
  });
  const config = getServerConfig();
  if (config.environment !== 'development' || config.providerMode !== 'live')
    throw new Error('LOCAL_LIVE_ONLY');
  const { work, account } = await resolvePocAccount(
    createServiceDataClient(config),
    parsed.options.mailboxAddress,
    parsed.action !== 'delete',
  );
  if (parsed.action === 'delete') {
    await store.remove(work);
    console.log('Referencias locales eliminadas.');
    return;
  }
  const runtime = createWorkerRuntime(config);
  const data = await runtime.dataFor(work);
  console.log('Preparando la muestra de la cuenta autorizada seleccionada…');
  const manifest = await prepareSentSample(await runtime.gmailFor(work), {
    ...parsed.options,
    mailboxAddress: account.email,
  });
  if ((await data.getAccount()).status !== 'CONNECTED')
    throw new GmailCredentialError('NOT_CONNECTED');
  const path = await store.save(work, manifest);
  console.log(
    JSON.stringify(
      {
        statistics: manifest.statistics,
        warnings: manifest.warnings,
        expiresAt: manifest.expiresAt,
        manifestPath: path,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    const code =
      error instanceof ConfigurationError
        ? error.message
        : error instanceof DataAccessError ||
            error instanceof GmailCredentialError ||
            error instanceof ProviderError ||
            error instanceof SentSampleError
          ? error.code
          : 'UNAVAILABLE';
    console.error(
      `No se pudo preparar la muestra: ${code}. Usa --help para revisar las opciones.`,
    );
    process.exitCode = 1;
  });
}
