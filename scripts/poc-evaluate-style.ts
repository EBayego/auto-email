import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import nextEnvironment from '@next/env';
import { ConfigurationError, getServerConfig } from '../src/config/env';
import { createServiceDataClient } from '../src/db/service-client';
import { resolvePocAccount } from '../src/db/poc-account';
import { createStyleRelationshipRepository } from '../src/db/style-relationships';
import { createStylePreferenceRepository } from '../src/db/style-preferences';
import { DataAccessError } from '../src/db/errors';
import { createWorkerRuntime } from '../src/worker/runtime';
import { createSentSampleStore } from '../src/poc/sent-sample-store';
import { createStyleEvaluationStore } from '../src/poc/style-evaluation-store';
import { prepareStyleEvaluationCorpus } from '../src/poc/style-evaluation-corpus';
import {
  evaluateHistoricalStyle,
  type BlindStyleCase,
} from '../src/poc/evaluate-style';
import {
  evaluationCaseSchema,
  styleDimensions,
  StyleEvaluationError,
  validateHumanStyleRating,
  type HumanStyleRating,
} from '../src/modules/identity/style-evaluation';
import { ProviderError } from '../src/providers/errors';
import { WritingProfileError } from '../src/modules/identity/writing-profile';
import { SentSampleError } from '../src/modules/identity/sent-sample';
import { GmailCredentialError } from '../src/modules/gmail/credentials';
import { ResponseGenerationError } from '../src/modules/response/contracts';

export const usage = `MAIL-028 — Comparación reservada de estilo con tres configuraciones.
Uso: npm run poc:evaluate-style -- --email CUENTA ACCIÓN [opciones]
  --prepare --case THREAD:TARGET:REPLY  Repetir para 10–20 hilos distintos.
                                     Reserva respuestas reales y excluye sus hilos del entrenamiento.
  --seed IDENTIFICADOR                Orden estable de ejecución y presentación.
  --run                              Recalcula perfiles de prueba y compara las tres configuraciones.
  --review                           Puntúa a ciegas en el terminal; muestra textos solo en esta sesión.
  --auto-review                      Evalúa automáticamente con una llamada separada por caso, sin preguntas.
                                     Incluye despedida, cercanía y ofrecimiento de ayuda.
  --examples N                       Ejemplos en las variantes personalizadas (0–3; por defecto 3).
  --with-preferences                 Aplica las preferencias explícitas guardadas a las variantes personalizadas.
  --report                           Muestra métricas y valoraciones guardadas, sin cuerpos de correo.
  --remove                           Borra el conjunto y su informe de esta cuenta.
  --alias EMAIL                      Alias propio confirmado; repetible en prepare y run.
  --help                             Muestra esta ayuda.
prepare requiere una muestra guardada de poc:sample. Se usa solo entrenamiento
anterior a todos los objetivos y separado de los hilos reservados; mínimo diez mensajes válidos.
run llama al modelo configurado (hasta 13 análisis y 120 llamadas de generación/verificación).
No crea borradores, no envía emails ni cambia perfiles o preferencias de producción.
Se guardan referencias y métricas durante un máximo de noventa días, nunca cuerpos ni propuestas.
La semilla fija los órdenes, no garantiza salidas idénticas del modelo.
auto-review añade hasta veinte llamadas y registra juicios del modelo sin validación humana;
Una salida truncada o con JSON inválido admite un único reintento compacto con el mismo límite, incluido en las métricas.
no entrena el modelo ni modifica la configuración. Las notas humanas permanecen separadas.`;

export function parseStyleEvaluationArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: 'string' },
      prepare: { type: 'boolean' },
      run: { type: 'boolean' },
      report: { type: 'boolean' },
      remove: { type: 'boolean' },
      case: { type: 'string', multiple: true },
      alias: { type: 'string', multiple: true },
      seed: { type: 'string' },
      examples: { type: 'string' },
      review: { type: 'boolean' },
      'auto-review': { type: 'boolean' },
      'with-preferences': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return { action: 'help' as const };
  const address = (value: string) =>
    value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+$/u.test(value);
  if (
    !values.email ||
    !address(values.email) ||
    (values.alias &&
      (values.alias.length > 100 || !values.alias.every(address))) ||
    [values.prepare, values.run, values.report, values.remove].filter(Boolean)
      .length !== 1 ||
    (values.seed !== undefined &&
      (!values.prepare || !/^[A-Za-z0-9_-]{1,80}$/.test(values.seed))) ||
    (values.review && !values.run) ||
    (values['auto-review'] && (!values.run || values.review)) ||
    (values['with-preferences'] && !values.run) ||
    (values.examples !== undefined &&
      (!values.run || !/^[0-3]$/.test(values.examples))) ||
    (values.case && !values.prepare) ||
    (values.alias && !(values.prepare || values.run))
  )
    throw new StyleEvaluationError('INVALID_EVALUATION');
  const cases = (values.case ?? []).map((value) => {
    const [threadId, targetMessageId, replyMessageId, ...rest] =
      value.split(':');
    const result = evaluationCaseSchema.safeParse({
      threadId,
      targetMessageId,
      replyMessageId,
    });
    if (rest.length || !result.success)
      throw new StyleEvaluationError('INVALID_EVALUATION');
    return result.data;
  });
  if (
    values.prepare &&
    (cases.length < 10 ||
      cases.length > 20 ||
      new Set(cases.map((c) => c.threadId)).size !== cases.length ||
      new Set(cases.flatMap((c) => [c.targetMessageId, c.replyMessageId]))
        .size !==
        cases.length * 2)
  )
    throw new StyleEvaluationError('INVALID_EVALUATION');
  return {
    action: values.prepare
      ? ('prepare' as const)
      : values.run
        ? ('run' as const)
        : values.report
          ? ('report' as const)
          : ('remove' as const),
    email: values.email.toLowerCase(),
    aliases: values.alias,
    cases,
    seed: values.seed ?? 'mail028',
    examples: Number(values.examples ?? 3),
    review: values.review ?? false,
    automaticReview: values['auto-review'] ?? false,
    withPreferences: values['with-preferences'] ?? false,
  };
}
export async function reviewBlindStyleCase(
  item: BlindStyleCase,
  ask: (question: string) => Promise<string>,
  show: (text: string) => void,
): Promise<Record<string, HumanStyleRating>> {
  show(
    `\n${item.caseId}\nConversación hasta el objetivo:\n${item.conversation.map((message) => `${message.speaker}${message.isTarget ? ' (objetivo)' : ''}: ${message.text}`).join('\n\n')}\n\nRespuesta histórica reservada:\n${item.referenceReply}`,
  );
  const result: Record<string, HumanStyleRating> = {};
  for (const candidate of item.candidates) {
    show(
      `\nPropuesta ${candidate.label}:\n${candidate.bodyText ?? '(Sin propuesta: abstención del generador)'}`,
    );
    if (candidate.status !== 'READY') continue;
    for (;;) {
      const answer = await ask(
        `Saludo, formalidad, vocabulario, longitud e idioma (cinco notas 1–5), aceptable s/n, segura s/n; separados por espacios: `,
      );
      const parts = answer.trim().split(/\s+/u);
      if (
        parts.length !== 7 ||
        parts.slice(0, 5).some((part) => !/^[1-5]$/.test(part)) ||
        parts.slice(5).some((part) => !/^[sn]$/i.test(part))
      ) {
        show('Introduce cinco notas y dos respuestas s/n.');
        continue;
      }
      const factors = await ask(
        'Factores que perjudican el estilo (greeting, formality, vocabulary, length, language, irrelevant_examples, profile_mismatch, unsupported_content), separados por comas; vacío si no hay: ',
      );
      try {
        result[candidate.label] = validateHumanStyleRating({
          scores: Object.fromEntries(
            styleDimensions.map((key, i) => [key, Number(parts[i])]),
          ),
          acceptable: parts[5].toLowerCase() === 's',
          safe: parts[6].toLowerCase() === 's',
          factors: factors.trim()
            ? factors.split(',').map((s) => s.trim())
            : [],
        });
        break;
      } catch {
        show('Revisa las puntuaciones y los factores permitidos.');
      }
    }
  }
  return result;
}
export async function main(args = process.argv.slice(2)) {
  const options = parseStyleEvaluationArgs(args);
  if (options.action === 'help') {
    console.log(usage);
    return;
  }
  if (options.review && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new StyleEvaluationError('INCOMPLETE_REVIEW');
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
  const client = createServiceDataClient(config),
    { work, account } = await resolvePocAccount(client, options.email);
  const store = createStyleEvaluationStore(
    resolve(root, '.cache/poc/style-evaluations'),
  );
  if (options.action === 'remove') {
    await store.remove(work);
    console.log(JSON.stringify({ removed: true }));
    return;
  }
  if (options.action === 'report') {
    const report = await store.loadReport(work);
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  const runtime = createWorkerRuntime(config),
    gmail = await runtime.gmailFor(work);
  const identity = {
    ...work,
    mailboxAddress: account.email,
    aliases: options.aliases,
  };
  if (options.action === 'prepare') {
    const sample = await createSentSampleStore(
      resolve(root, '.cache/poc/sent-samples'),
    ).load(work);
    if (!sample) throw new WritingProfileError('SAMPLE_REQUIRED');
    const corpus = await prepareStyleEvaluationCorpus({
      gmail,
      identity,
      sample,
      cases: options.cases,
      seed: options.seed,
    });
    await store.saveCorpus(work, corpus);
    console.log(
      JSON.stringify({
        prepared: true,
        cases: corpus.cases.length,
        trainingReferences: corpus.training.sourceMessages.length,
      }),
    );
    return;
  }
  const corpus = await store.loadCorpus(work);
  const rules = await createStyleRelationshipRepository(
    client,
    work.userId,
    work.gmailAccountId,
  ).list();
  const preferences = options.withPreferences
    ? await createStylePreferenceRepository(
        client,
        work.userId,
        work.gmailAccountId,
      ).list()
    : [];
  const terminal = options.review
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  try {
    const report = await evaluateHistoricalStyle({
      gmail,
      text: runtime.providers.text,
      identity,
      corpus,
      model: config.openai.model,
      rules,
      preferences,
      examples: options.examples,
      automaticReview: options.automaticReview,
      progress: options.automaticReview
        ? ({ completedCases, totalCases }) =>
            console.log(
              `Evaluación automática: ${completedCases}/${totalCases} casos.`,
            )
        : undefined,
      review: terminal
        ? (item) =>
            reviewBlindStyleCase(
              item,
              (question) => terminal.question(question),
              (text) => console.log(text),
            )
        : undefined,
    });
    await store.saveReport(work, report);
    console.log(
      JSON.stringify(
        {
          summary: report.summary,
          mvpPolicy: report.mvpPolicy,
          modelCalls: report.cases.reduce(
            (sum, c) => sum + c.variants.reduce((n, v) => n + v.modelCalls, 0),
            report.analysisCalls + (report.automaticEvaluator?.modelCalls ?? 0),
          ),
        },
        null,
        2,
      ),
    );
    return report;
  } finally {
    terminal?.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error: unknown) => {
    const code =
      error instanceof StyleEvaluationError ||
      error instanceof DataAccessError ||
      error instanceof ProviderError ||
      error instanceof WritingProfileError ||
      error instanceof SentSampleError ||
      error instanceof GmailCredentialError ||
      error instanceof ResponseGenerationError
        ? error.code
        : error instanceof ConfigurationError
          ? error.message
          : 'UNAVAILABLE';
    console.error(`No se pudo evaluar el estilo: ${code}. Usa --help.`);
    process.exitCode = 1;
  });
