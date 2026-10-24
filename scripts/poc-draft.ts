import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { createWritingProfileRepository } from '../src/db/writing-profiles';
import { selectContextualWritingProfile } from '../src/db/contextual-styles';
import { createDraftGenerationRepository } from '../src/db/draft-generations';
import { DataAccessError } from '../src/db/errors';
import { createSentSampleStore } from '../src/poc/sent-sample-store';
import { createReplyDraftForThread } from '../src/poc/create-reply-draft';
import { createWorkerRuntime } from '../src/worker/runtime';
import { validateManualSelection } from '../src/modules/gmail/manual-selection';
import { ConversationError } from '../src/modules/gmail/conversation';
import { GmailCredentialError } from '../src/modules/gmail/credentials';
import { DraftWriteError } from '../src/modules/gmail/draft-contracts';
import { WritingProfileError } from '../src/modules/identity/writing-profile';
import { SentSampleError } from '../src/modules/identity/sent-sample';
import { ResponseGenerationError } from '../src/modules/response/contracts';
import { ProviderError } from '../src/providers/errors';
import { StyleExampleRetrievalError } from '../src/modules/identity/style-example-retriever';
import { createStylePreferenceRepository } from '../src/db/style-preferences';
import { StylePreferenceError } from '../src/modules/identity/style-preferences';

export const usage = `MAIL-021 — Genera y crea un borrador de respuesta en Gmail.
Uso: npm run poc:draft -- --email cuenta@gmail.com --thread-id THREAD_ID [opciones]
  --message-id MESSAGE_ID  Objetivo concreto; por defecto, el último entrante de INBOX.
  --alias EMAIL           Alias propio confirmado por el operador; repetible.
  --style-examples N      Ejemplos relevantes de enviados, bajo demanda (0–3; por defecto 3).
  --help                  Muestra esta ayuda.
Requiere el perfil confirmado de MAIL-018 y una respuesta READY de MAIL-020.
Revalida el hilo antes de crear. Si hay respuesta posterior, borrador previo o
contexto cambiado, se detiene. Guarda únicamente IDs, estados y métricas.
RECONCILIATION_REQUIRED exige comprobar Gmail antes de cualquier nuevo intento.
El borrador se revisa en Gmail; este comando no envía mensajes.`;

export function parseDraftArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      'thread-id': { type: 'string' },
      'message-id': { type: 'string' },
      alias: { type: 'string', multiple: true },
      'style-examples': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  const selection = {
    accountId: 'local-validation',
    mailboxAddress: values.email!,
    threadId: values['thread-id']!,
    targetMessageId: values['message-id'],
    aliases: values.alias,
  };
  validateManualSelection(selection);
  if (
    values['style-examples'] !== undefined &&
    !/^[0-3]$/.test(values['style-examples'])
  )
    throw new ResponseGenerationError('INVALID_INPUT');
  return {
    action: 'create' as const,
    selection: {
      ...selection,
      mailboxAddress: selection.mailboxAddress.toLowerCase(),
    },
    examples:
      values['style-examples'] === undefined
        ? 3
        : Number(values['style-examples']),
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseDraftArgs(args);
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
  const report = await createReplyDraftForThread({
    gmail: await runtime.gmailFor(work),
    text: runtime.providers.text,
    retrieveKnowledge: await runtime.knowledgeFor(work),
    policy: await runtime.policyFor(work),
    factualValidation: await runtime.factualValidationFor(work),
    selection: {
      ...options.selection,
      accountId: work.gmailAccountId,
      mailboxAddress: account.email,
      style: { revision: profile.revision, profile: profile.profile },
      resolvePreferences: (recipient) =>
        createStylePreferenceRepository(
          client,
          work.userId,
          work.gmailAccountId,
        ).resolve(recipient),
      resolveStyle: async (recipient) => {
        const chosen = await selectContextualWritingProfile(
          client,
          work.userId,
          work.gmailAccountId,
          recipient,
        );
        if (!chosen)
          throw new ResponseGenerationError('STYLE_PROFILE_REQUIRED');
        return chosen
          ? {
              revision: chosen.revision,
              profile: chosen.profile,
              ...(chosen.scope_kind !== 'GENERAL'
                ? { exampleMessageIds: chosen.source_message_ids }
                : {}),
              scopeKind: chosen.scope_kind as
                'GENERAL' | 'RECIPIENT' | 'DOMAIN' | 'RELATIONSHIP',
            }
          : null;
      },
    },
    sample,
    styleExamplesLimit: options.examples,
    store: createDraftGenerationRepository(
      client,
      work.userId,
      work.gmailAccountId,
    ),
    model: config.openai.model,
  });
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
            error instanceof ConversationError ||
            error instanceof GmailCredentialError ||
            error instanceof DraftWriteError ||
            error instanceof WritingProfileError ||
            error instanceof SentSampleError ||
            error instanceof StyleExampleRetrievalError ||
            error instanceof StylePreferenceError ||
            error instanceof ResponseGenerationError ||
            error instanceof ProviderError
          ? error.code
          : 'UNAVAILABLE';
    console.error(
      `No se pudo crear el borrador: ${code}. Usa --help para revisar las opciones.`,
    );
    process.exitCode = 1;
  });
}
