import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { createWritingProfileRepository } from '../src/db/writing-profiles';
import { createSentSampleStore } from '../src/poc/sent-sample-store';
import { createWorkerRuntime } from '../src/worker/runtime';
import { DataAccessError } from '../src/db/errors';
import { GmailCredentialError } from '../src/modules/gmail/credentials';
import { ResponseGenerationError } from '../src/modules/response/contracts';
import { validateManualSelection } from '../src/modules/gmail/manual-selection';
import { ConversationError } from '../src/modules/gmail/conversation';
import { ProviderError } from '../src/providers/errors';
import {
  PocValidationError,
  validateCases,
  validateReplySamples,
  type ValidationCase,
} from '../src/poc/validate-replies';

export const usage = `MAIL-022 — Evaluación manual de 10–20 conversaciones reales en modo seco.
Uso: npm run poc:validate -- --email cuenta@gmail.com --case THREAD_ID:ESPERADO ...
  --case THREAD_ID[:MESSAGE_ID]:ESPERADO  Repetir para 10–20 hilos distintos.
  --alias EMAIL                          Alias propio confirmado; repetible.
  --style-examples N                     Ejemplos en memoria (0–3; por defecto 3).
  --preview                              Muestra propuestas y datos que faltan.
  --help                                 Muestra esta ayuda.
Resultados esperados: READY, NO_REPLY_REQUIRED, INSUFFICIENT_CONTEXT, BLOCKED,
REVIEW_REQUIRED, ALREADY_ANSWERED, EXISTING_DRAFT, NO_CANDIDATE, SUPERSEDED.
NO_REPLY_REQUIRED incluye exclusiones por newsletter, automatismos y no-reply.
Solo lee los hilos elegidos y llama a OpenAI cuando son elegibles. Comprueba el
MIME en memoria y compara Gmail antes/después. No crea ni envía mensajes.
El JSON contiene IDs, estados, métricas y fallos por categoría; la calidad de
las propuestas READY requiere evaluación humana y no se puntúa automáticamente.`;

export function parseValidationArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      case: { type: 'string', multiple: true },
      alias: { type: 'string', multiple: true },
      'style-examples': { type: 'string' },
      preview: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  const cases = (values.case ?? []).map((value): ValidationCase => {
    const parts = value.split(':');
    if (parts.length !== 2 && parts.length !== 3)
      throw new PocValidationError();
    return {
      threadId: parts[0],
      targetMessageId: parts.length === 3 ? parts[1] : undefined,
      expected: parts.at(-1) as ValidationCase['expected'],
    };
  });
  validateCases(cases);
  const selection = {
    accountId: 'local-validation',
    mailboxAddress: values.email!,
    aliases: values.alias,
  };
  for (const item of cases) validateManualSelection({ ...selection, ...item });
  if (
    values['style-examples'] !== undefined &&
    !/^[0-3]$/.test(values['style-examples'])
  )
    throw new PocValidationError();
  return {
    action: 'validate' as const,
    selection: {
      ...selection,
      mailboxAddress: selection.mailboxAddress.toLowerCase(),
    },
    cases,
    examples:
      values['style-examples'] === undefined
        ? 3
        : Number(values['style-examples']),
    preview: values.preview ?? false,
  };
}
export async function main(args = process.argv.slice(2)) {
  const options = parseValidationArgs(args);
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
  const { work, account } = await resolvePocAccount(
    client,
    options.selection.mailboxAddress,
  );
  const profile = await createWritingProfileRepository(
    client,
    work.userId,
    work.gmailAccountId,
  ).get();
  if (profile?.review_status !== 'CONFIRMED')
    throw new ResponseGenerationError('STYLE_PROFILE_REQUIRED');
  const runtime = createWorkerRuntime(config);
  const sample = options.examples
    ? await createSentSampleStore(
        resolve(root, '.cache/poc/sent-samples'),
      ).load(work)
    : null;
  let completed = 0;
  const report = await validateReplySamples({
    gmail: await runtime.gmailFor(work),
    text: runtime.providers.text,
    cases: options.cases,
    selection: {
      ...options.selection,
      accountId: work.gmailAccountId,
      mailboxAddress: account.email,
      style: { revision: profile.revision, profile: profile.profile },
    },
    sample,
    styleExamplesLimit: options.examples,
    consume: async (response, context) => {
      if (options.preview)
        console.log(
          JSON.stringify({
            preview: {
              threadId: context.threadId,
              status: response.status,
              bodyText: response.bodyText,
              missingInformation: response.missingInformation,
            },
          }),
        );
    },
    onCase: (item) => {
      completed++;
      console.error(
        `${completed}/${options.cases.length}: ${item.threadId} — ${item.actual} — ${item.passed ? 'PASS' : 'FAIL'}`,
      );
    },
  });
  console.log(JSON.stringify(report, null, 2));
  // A mismatch must be visible to automation, while retaining the full report.
  if (report.failed) process.exitCode = 1;
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
            error instanceof GmailCredentialError ||
            error instanceof ResponseGenerationError ||
            error instanceof ConversationError ||
            error instanceof ProviderError
          ? error.code
          : error instanceof PocValidationError
            ? 'INVALID_INPUT'
            : 'UNAVAILABLE';
    console.error(
      `No se pudo validar la muestra: ${code}. Usa --help para revisar las opciones.`,
    );
    process.exitCode = 1;
  });
}
