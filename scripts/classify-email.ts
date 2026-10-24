import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { DataAccessError } from '../src/db/errors';
import { createClassifierExclusionRepository } from '../src/db/classifier-exclusions';
import { createWorkerRuntime } from '../src/worker/runtime';
import {
  normalizeClassifierAddress,
  normalizeClassifierExclusions,
} from '../src/modules/classifier/rules';
import { EmailClassificationError } from '../src/modules/classifier/contracts';
import { GmailCredentialError } from '../src/modules/gmail/credentials';
import { ProviderError } from '../src/providers/errors';

export const usage = `MAIL-030 — Clasificador de correos (sin crear borradores).
Uso: npm run mail:classify -- --email cuenta@gmail.com --message-id MESSAGE_ID [opciones]
  --exclude-address EMAIL  Exclusión adicional para esta ejecución; repetible.
  --exclude-domain DOMAIN Exclusión adicional para dominio y subdominios; repetible.
  --save-exclusions        Guardar las exclusiones indicadas para este usuario, sin clasificar.
                          Sustituye su configuración anterior; sin exclusiones la vacía.
  --help                   Mostrar esta ayuda.
Ejemplo de configuración: npm run mail:classify -- --email cuenta@gmail.com --save-exclusions --exclude-domain boletines.example.com
La clasificación utiliza también las exclusiones guardadas y consulta OpenAI solo
si los metadatos no resuelven el caso. La salida contiene únicamente IDs, categorías
y contadores; no imprime ni guarda cuerpos, asuntos, prompts o respuestas libres.`;

export function parseClassifyArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      'message-id': { type: 'string' },
      'exclude-address': { type: 'string', multiple: true },
      'exclude-domain': { type: 'string', multiple: true },
      'save-exclusions': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  const email = normalizeClassifierAddress(values.email!);
  const exclusions = normalizeClassifierExclusions({
    excludedAddresses: values['exclude-address'],
    excludedDomains: values['exclude-domain'],
  });
  if (values['save-exclusions']) {
    if (values['message-id'] !== undefined)
      throw new EmailClassificationError('INVALID_INPUT');
    return { action: 'configure' as const, email, exclusions };
  }
  const messageId = values['message-id'];
  if (!messageId || !/^[A-Za-z0-9_-]{1,512}$/.test(messageId))
    throw new EmailClassificationError('INVALID_INPUT');
  return { action: 'classify' as const, email, messageId, exclusions };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseClassifyArgs(args);
  if (options.action === 'help') {
    console.log(usage);
    return;
  }
  nextEnvironment.loadEnvConfig(
    fileURLToPath(new URL('../', import.meta.url)),
    true,
    {
      info() {},
      error() {
        throw new Error('ENV_FILE');
      },
    },
  );
  const config = getServerConfig();
  if (config.environment !== 'development' || config.providerMode !== 'live')
    throw new Error('LOCAL_LIVE_ONLY');
  const client = createServiceDataClient(config);
  const { work } = await resolvePocAccount(
    client,
    options.email,
    options.action === 'classify',
  );
  if (options.action === 'configure') {
    const saved = await createClassifierExclusionRepository(
      client,
      work.userId,
      work.gmailAccountId,
    ).set(options.exclusions);
    const report = {
      status: 'EXCLUSIONS_SAVED',
      accountId: work.gmailAccountId,
      excludedAddresses: saved.excludedAddresses.length,
      excludedDomains: saved.excludedDomains.length,
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  const classifier = await createWorkerRuntime(config).classifierFor(work);
  const result = await classifier.classify(
    options.messageId,
    options.exclusions,
  );
  const report = {
    accountId: work.gmailAccountId,
    messageId: options.messageId,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
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
            error instanceof EmailClassificationError ||
            error instanceof GmailCredentialError ||
            error instanceof ProviderError
          ? error.code
          : 'UNAVAILABLE';
    console.error(
      `No se pudo completar la clasificación: ${code}. Usa --help para revisar las opciones.`,
    );
    process.exitCode = 1;
  });
}
