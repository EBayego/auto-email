import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { createWritingProfileRepository } from '../src/db/writing-profiles';
import { DataAccessError } from '../src/db/errors';
import { createWorkerRuntime } from '../src/worker/runtime';
import { ConversationError } from '../src/modules/gmail/conversation';
import {
  selectPendingEmail,
  validateManualSelection,
} from '../src/modules/gmail/manual-selection';
import { GmailCredentialError } from '../src/modules/gmail/credentials';
import { WritingProfileError } from '../src/modules/identity/writing-profile';
import { ProviderError } from '../src/providers/errors';

export const usage = `MAIL-019 — Selector manual de un email pendiente (solo lectura).
Uso: npm run poc:select -- --email cuenta@gmail.com --thread-id THREAD_ID [opciones]
  --message-id MESSAGE_ID  Selecciona un mensaje concreto del hilo; por defecto, el último entrante de INBOX.
  --alias EMAIL           Alias propio confirmado por el operador; repetible.
  --help                  Muestra esta ayuda.
SELECTED indica que se ha preparado el contexto en memoria para el generador.
Se comprueban respuestas posteriores, borradores, identidad, destinatarios y límites.
Los otros estados explican por qué el hilo se omite o necesita revisión.
La salida contiene solo IDs, estados y métricas. Los cuerpos no se guardan ni se
imprimen; el contexto se entrega al siguiente módulo mediante un callback.
El comando consulta el perfil confirmado de MAIL-018 y prepara datos para OpenAI,
sin llamar al modelo ni crear borradores.`;

export function parseSelectArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      'thread-id': { type: 'string' },
      'message-id': { type: 'string' },
      alias: { type: 'string', multiple: true },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  const input = {
    accountId: 'local-validation',
    mailboxAddress: values.email!,
    threadId: values['thread-id']!,
    targetMessageId: values['message-id'],
    aliases: values.alias,
  };
  validateManualSelection(input);
  return {
    action: 'select' as const,
    ...input,
    mailboxAddress: input.mailboxAddress.toLowerCase(),
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseSelectArgs(args);
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
    options.mailboxAddress,
  );
  const storedStyle = await createWritingProfileRepository(
    client,
    work.userId,
    work.gmailAccountId,
  ).get();
  const runtime = createWorkerRuntime(config);
  const result = await selectPendingEmail(await runtime.gmailFor(work), {
    accountId: work.gmailAccountId,
    mailboxAddress: account.email,
    threadId: options.threadId,
    targetMessageId: options.targetMessageId,
    aliases: options.aliases,
    ...(storedStyle?.review_status === 'CONFIRMED'
      ? {
          style: {
            revision: storedStyle.revision,
            profile: storedStyle.profile,
          },
        }
      : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
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
            error instanceof ConversationError ||
            error instanceof GmailCredentialError ||
            error instanceof WritingProfileError ||
            error instanceof ProviderError
          ? error.code
          : 'UNAVAILABLE';
    console.error(
      `No se pudo seleccionar el email: ${code}. Usa --help para revisar las opciones.`,
    );
    process.exitCode = 1;
  });
}
