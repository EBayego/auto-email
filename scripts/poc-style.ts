import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { createWritingProfileRepository } from '../src/db/writing-profiles';
import { DataAccessError, requireUuid } from '../src/db/errors';
import { createWorkerRuntime } from '../src/worker/runtime';
import { createSentSampleStore } from '../src/poc/sent-sample-store';
import { generateWritingProfile } from '../src/poc/generate-writing-profile';
import { WritingProfileError } from '../src/modules/identity/writing-profile';
import { GmailCredentialError } from '../src/modules/gmail/credentials';
import { SentSampleError } from '../src/modules/identity/sent-sample';
import { ProviderError } from '../src/providers/errors';
import {
  normalizeStyleScope,
  ContextualStyleError,
} from '../src/modules/identity/contextual-style';
import { createStyleRelationshipRepository } from '../src/db/style-relationships';
import { generateContextualStyles } from '../src/poc/generate-contextual-styles';

export const usage = `MAIL-018 — Perfil de escritura de la cuenta de prueba autorizada.
Uso: npm run poc:style -- --email cuenta@gmail.com [opciones]
  Sin opciones    Reutiliza el perfil existente; si falta, analiza la muestra de MAIL-017.
  --refresh       Regenera con OpenAI el perfil de la muestra guardada.
  --show          Consulta el perfil guardado sin leer Gmail ni llamar a OpenAI.
  --alias EMAIL   Alias propio confirmado al preparar la muestra; repetible.
  --confirm UUID  Confirma manualmente la revisión mostrada tras comprobar su estilo.
  --contexts      Analiza grupos con evidencia suficiente de la muestra guardada.
  --recipient EMAIL | --domain DOMINIO | --relationship CATEGORIA
                  Selecciona un perfil contextual para --show o --confirm.
  --help          Muestra esta ayuda.
Los textos solo se procesan en memoria. Supabase guarda el perfil derivado y métricas.
El perfil nuevo queda UNREVIEWED; --refresh reinicia la revisión.`;

export function parseStyleArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      refresh: { type: 'boolean' },
      show: { type: 'boolean' },
      confirm: { type: 'string' },
      alias: { type: 'string', multiple: true },
      help: { type: 'boolean' },
      contexts: { type: 'boolean' },
      recipient: { type: 'string' },
      domain: { type: 'string' },
      relationship: { type: 'string' },
    },
  });
  if (values.help) return { action: 'help' as const };
  const selectors = [
    values.recipient,
    values.domain,
    values.relationship,
  ].filter((v) => v !== undefined).length;
  const scope = normalizeStyleScope(
    values.recipient !== undefined
      ? { kind: 'RECIPIENT', key: values.recipient }
      : values.domain !== undefined
        ? { kind: 'DOMAIN', key: values.domain }
        : values.relationship !== undefined
          ? { kind: 'RELATIONSHIP', key: values.relationship.toUpperCase() }
          : { kind: 'GENERAL', key: '' },
  );
  if (
    !values.email ||
    selectors > 1 ||
    (values.contexts &&
      (selectors > 0 ||
        values.refresh ||
        values.show ||
        values.confirm !== undefined)) ||
    (selectors > 0 && !values.show && !values.confirm) ||
    !/^[^\s<>@]+@[^\s<>@]+$/u.test(values.email) ||
    values.email.length > 254 ||
    (values.alias &&
      (values.alias.length > 100 ||
        values.alias.some((email) => !/^[^\s<>@]+@[^\s<>@]+$/u.test(email)))) ||
    [values.refresh, values.show, values.confirm !== undefined].filter(Boolean)
      .length > 1
  )
    throw new DataAccessError('INVALID_INPUT');
  if (values.confirm !== undefined) requireUuid(values.confirm);
  return {
    action: values.contexts
      ? ('contexts' as const)
      : values.confirm
        ? ('confirm' as const)
        : values.show
          ? ('show' as const)
          : ('generate' as const),
    email: values.email.toLowerCase(),
    aliases: values.alias,
    refresh: values.refresh ?? false,
    revision: values.confirm,
    scope,
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseStyleArgs(args);
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
  const { work, account } = await resolvePocAccount(client, options.email);
  const repository = createWritingProfileRepository(
    client,
    work.userId,
    work.gmailAccountId,
    options.scope,
  );
  if (options.action === 'contexts') {
    const general = await repository.get();
    if (general?.review_status !== 'CONFIRMED')
      throw new ContextualStyleError('GENERAL_PROFILE_REQUIRED');
    const store = createSentSampleStore(
      resolve(root, '.cache/poc/sent-samples'),
    );
    await store.purgeExpired();
    const manifest = await store.load(work);
    if (!manifest) throw new WritingProfileError('SAMPLE_REQUIRED');
    const rules = await createStyleRelationshipRepository(
      client,
      work.userId,
      work.gmailAccountId,
    ).list();
    const runtime = createWorkerRuntime(config);
    const report = await generateContextualStyles({
      gmail: await runtime.gmailFor(work),
      text: runtime.providers.text,
      manifest,
      mailboxAddress: account.email,
      aliases: options.aliases,
      model: config.openai.model,
      general,
      rules,
      ruleRevisions: rules.map((r) => r.revision),
      save: (scope, input) =>
        createWritingProfileRepository(
          client,
          work.userId,
          work.gmailAccountId,
          scope,
        ).save(input),
    });
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  let result;
  let reused = false;
  if (options.action === 'confirm')
    result = await repository.confirm(options.revision!);
  else {
    result = await repository.get();
    if (options.action === 'show') {
      if (!result) throw new DataAccessError('NOT_FOUND');
    } else if (!result || options.refresh) {
      const store = createSentSampleStore(
        resolve(root, '.cache/poc/sent-samples'),
      );
      await store.purgeExpired();
      const manifest = await store.load(work);
      if (!manifest) throw new WritingProfileError('SAMPLE_REQUIRED');
      const runtime = createWorkerRuntime(config);
      console.log('Analizando la muestra guardada con OpenAI…');
      result = await generateWritingProfile({
        gmail: await runtime.gmailFor(work),
        text: runtime.providers.text,
        manifest,
        mailboxAddress: account.email,
        aliases: options.aliases,
        model: config.openai.model,
        repository,
      });
    } else reused = true;
  }
  console.log(
    JSON.stringify(
      {
        revision: result.revision,
        version: result.version,
        schemaVersion: result.profile.schema_version,
        origin: result.origin,
        scope: result.scope_kind,
        updatedAt: result.updated_at,
        reviewStatus: result.review_status,
        reused,
        sampleSize: result.sample_size,
        model: result.model,
        warnings: result.warnings,
        inputTokens: result.input_tokens,
        outputTokens: result.output_tokens,
        profile: result.profile,
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
        : error instanceof ContextualStyleError ||
            error instanceof DataAccessError ||
            error instanceof WritingProfileError ||
            error instanceof GmailCredentialError ||
            error instanceof SentSampleError ||
            error instanceof ProviderError
          ? error.code
          : 'UNAVAILABLE';
    console.error(
      `No se pudo obtener el perfil: ${code}. Usa --help para revisar las opciones.`,
    );
    process.exitCode = 1;
  });
}
