import { z } from 'zod';
import { emailJobStatuses } from './email-job';

const time = z.iso.datetime({ offset: true });
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const gmailId = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);
export const activityQuerySchema = z
  .strictObject({
    status: z.enum(['ALL', ...emailJobStatuses]).default('ALL'),
    before: time.optional(),
    beforeId: z.uuid().optional(),
  })
  .refine((value) => !!value.before === !!value.beforeId);
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
const draftSchema = z.strictObject({
  status: z.enum(['CREATING', 'CREATED', 'UNCERTAIN', 'CANCELLED']),
  draftId: gmailId.nullable(),
  verifiedAt: time.nullable(),
  reconciliation: code.nullable(),
  createdAt: time,
  updatedAt: time,
  warnings: z.array(code).max(32),
});
export const activityJobSchema = z.strictObject({
  id: z.uuid(),
  threadId: gmailId,
  status: z.enum(emailJobStatuses),
  reason: code.nullable(),
  category: code.nullable(),
  classificationReasons: z.array(code).max(32),
  risks: z.array(code).max(32),
  attempts: z.int().nonnegative(),
  createdAt: time,
  updatedAt: time,
  startedAt: time.nullable(),
  finishedAt: time.nullable(),
  draftId: gmailId.nullable(),
  draft: draftSchema.nullable(),
});
const runSchema = z.strictObject({
  id: z.uuid(),
  trigger: z.enum(['MANUAL', 'SCHEDULED', 'RETRY']),
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  startedAt: time,
  finishedAt: time.nullable(),
  detected: z.int().nonnegative(),
  processed: z.int().nonnegative(),
  drafts: z.int().nonnegative(),
  errors: z.int().nonnegative(),
  error: code.nullable(),
});
export const activityFeedSchema = z.strictObject({
  overview: z.strictObject({
    accountEmail: z.email().nullable(),
    accountStatus: z
      .enum(['CONNECTED', 'PAUSED', 'DISCONNECTED', 'REAUTH_REQUIRED'])
      .nullable(),
    automationEnabled: z.boolean(),
    pollSeconds: z.int().positive(),
    dailyLimit: z.int().nonnegative(),
    lastSyncAt: time.nullable(),
    manualUntil: time.nullable(),
    manualActive: z.boolean(),
  }),
  counts: z.record(z.enum(emailJobStatuses), z.int().nonnegative()),
  runs: z.array(runSchema).max(20),
  jobs: z.array(activityJobSchema).max(21),
});
export type ActivityFeed = z.infer<typeof activityFeedSchema> & {
  nextCursor: { before: string; beforeId: string } | null;
};
export type ActivityJob = z.infer<typeof activityJobSchema>;
const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('THREAD_MESSAGE') }),
  z.strictObject({ kind: z.literal('HISTORICAL_MESSAGE') }),
  z.strictObject({
    kind: z.literal('KNOWLEDGE_FRAGMENT'),
    sourceTitle: z.string().max(100).nullable(),
    documentName: z.string().max(255).nullable(),
    version: z.int().positive(),
    currentVersion: z.int().positive().nullable(),
    available: z.boolean(),
  }),
]);
export const activityDetailSchema = z.strictObject({
  job: activityJobSchema,
  events: z
    .array(
      z.strictObject({
        at: time,
        from: z.enum(emailJobStatuses).nullable(),
        to: z.enum(emailJobStatuses),
        reason: code.nullable(),
      }),
    )
    .max(100),
  eventsTruncated: z.boolean(),
  policies: z
    .array(
      z.strictObject({
        at: time,
        phase: z.enum(['PREFLIGHT', 'POSTFLIGHT']),
        action: z.enum(['ALLOW_DRAFT', 'REVIEW_REQUIRED', 'BLOCK']),
        reasons: z.array(code).max(32),
      }),
    )
    .max(50),
  policiesTruncated: z.boolean(),
  validations: z
    .array(
      z.strictObject({
        at: time,
        status: z.enum(['SUPPORTED', 'REVIEW_REQUIRED']),
        claims: z.int().nonnegative(),
        issues: z.array(z.strictObject({ kind: code, reason: code })).max(32),
      }),
    )
    .max(20),
  validationsTruncated: z.boolean(),
  sources: z.array(sourceSchema).max(12),
});
export type ActivityDetail = z.infer<typeof activityDetailSchema>;
export const jobLabels: Record<ActivityJob['status'], string> = {
  PENDING: 'Pendiente',
  CLASSIFYING: 'Analizando',
  GENERATING: 'Preparando respuesta',
  DRAFT_CREATED: 'Borrador creado',
  SKIPPED: 'Omitido',
  REVIEW_REQUIRED: 'Requiere revisión',
  FAILED: 'Fallido',
};
export const runLabels = {
  RUNNING: 'En curso',
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
} as const;
export const triggerLabels = {
  MANUAL: 'Revisión manual',
  SCHEDULED: 'Revisión programada',
  RETRY: 'Reintento',
} as const;
const reasons: Record<string, string> = {
  ACCOUNT_DISCONNECTED:
    'La cuenta Gmail se ha desconectado y el trabajo se ha detenido.',
  STYLE_DELETED:
    'Se ha borrado el perfil de escritura y se ha detenido este trabajo.',
  ACCOUNT_DELETION: 'Se ha solicitado eliminar la cuenta y sus datos.',
  SPAM: 'El mensaje está marcado como spam.',
  TRASH: 'El mensaje está en la papelera.',
  NOT_INCOMING: 'El mensaje es del titular, un enviado o un borrador.',
  OUTSIDE_SELECTION: 'El mensaje queda fuera de la selección de correos.',
  CATEGORY_EXCLUDED: 'Este tipo de correo está excluido.',
  EXCLUDED_SENDER: 'El remitente está excluido.',
  EXCLUDED_DOMAIN: 'El dominio está excluido.',
  NEWSLETTER: 'El mensaje es un boletín o envío masivo.',
  AUTOREPLY: 'Es una respuesta automática.',
  AUTO_GENERATED: 'Es una notificación automática.',
  NO_REPLY_ADDRESS: 'La dirección no admite respuestas.',
  EXPLICIT_QUESTION: 'El correo contiene una pregunta.',
  ACTION_REQUEST: 'Se solicita una actuación.',
  CONFIRMATION_REQUEST: 'Se solicita confirmación.',
  FOLLOW_UP_REQUEST: 'Se solicita seguimiento.',
  INFORMATION_ONLY: 'El mensaje solo aporta información.',
  ACKNOWLEDGEMENT_ONLY: 'El mensaje es un agradecimiento o acuse.',
  AUTOMATED_NOTIFICATION: 'Es una notificación automática.',
  NEWSLETTER_CONTENT: 'El contenido es un boletín.',
  NO_RESPONSE_EXPECTED: 'No se espera una respuesta.',
  INSUFFICIENT_CONTEXT: 'No hay contexto suficiente para responder.',
  AMBIGUOUS_INTENT: 'La intención no se ha podido determinar.',
  HIGH_RISK: 'El contenido requiere una decisión humana.',
  PROMPT_INJECTION:
    'Se han detectado instrucciones que intentan alterar el comportamiento del asistente.',
  ATTACHMENT_REQUIRED: 'La respuesta depende de un adjunto que no se ha leído.',
  EXISTING_MANUAL_DRAFT: 'Ya hay un borrador manual en la conversación.',
  EXISTING_SYSTEM_DRAFT: 'Ya existe un borrador del asistente.',
  TARGET_ALREADY_PROCESSED: 'El mensaje ya se había procesado.',
  ALREADY_ANSWERED: 'La conversación ya tiene una respuesta del titular.',
  TARGET_SUPERSEDED: 'Ha llegado un mensaje más reciente.',
  TARGET_NOT_ELIGIBLE: 'El mensaje ya no reúne las condiciones para responder.',
  POSSIBLE_EXISTING_REPLY:
    'Puede existir una respuesta previa; compruébalo en Gmail.',
  THREAD_UNVERIFIABLE:
    'No se ha podido verificar el estado de la conversación.',
  DRAFT_RECONCILIATION_REQUIRED:
    'Hay que comprobar en Gmail si el borrador se creó. No se repetirá la escritura automáticamente.',
  DRAFT_ATTEMPT_CANCELLED:
    'La creación del borrador se canceló antes de escribir.',
  THREAD_CHANGED: 'La conversación cambió durante la preparación.',
  PREWRITE_FAILED: 'Una comprobación previa impidió crear el borrador.',
  GMAIL_WRITE_UNCERTAIN:
    'Gmail no confirmó el resultado de la creación del borrador.',
  PERSISTENCE_FAILED: 'No se pudo registrar la confirmación del borrador.',
  VERIFICATION_FAILED: 'No se ha podido verificar el borrador en Gmail.',
  DAILY_DRAFT_LIMIT: 'Se ha alcanzado el límite diario de borradores.',
  STYLE_PROFILE_REQUIRED:
    'Revisa y confirma el perfil de escritura antes de generar respuestas.',
  STYLE_PROFILE_UNAVAILABLE:
    'No se ha podido consultar el perfil de escritura.',
  GENERATOR_NOT_CONFIGURED: 'La generación de respuestas no está configurada.',
  WORKER_STOPPED: 'El procesamiento se ha detenido.',
  CLASSIFICATION_INTERRUPTED:
    'El análisis se interrumpió y puede reintentarse.',
  GENERATION_INTERRUPTED:
    'La generación se interrumpió; requiere comprobar el resultado.',
  GENERATION_OUTCOME_UNKNOWN:
    'El resultado de la generación es incierto; requiere revisión.',
  MANUAL_RETRY: 'Se ha solicitado un reintento.',
  MODEL_UNAVAILABLE: 'El servicio de IA no pudo completar el análisis.',
  INVALID_MODEL_RESPONSE: 'La IA no devolvió un resultado válido.',
  LOW_CONFIDENCE: 'No hay suficiente certeza para proponer una respuesta.',
  INVALID_MESSAGE: 'No se pudo interpretar el mensaje.',
  MESSAGE_CHANGED: 'El mensaje cambió mientras se analizaba.',
  INCOMPLETE_CONTENT: 'El contenido disponible está incompleto.',
  EMPTY_CONTENT: 'No hay texto suficiente para analizar.',
  CONTENT_LIMIT_EXCEEDED: 'El contenido supera el límite de análisis.',
  AMBIGUOUS_HEADERS:
    'Las cabeceras no permiten identificar la respuesta de forma segura.',
  AMBIGUOUS_RECIPIENTS: 'Los destinatarios necesitan revisión.',
  SENDER_BLOCKED:
    'Una restricción bloquea respuestas a este remitente o dominio.',
  CATEGORY_BLOCKED: 'Una restricción bloquea este tipo de correo.',
  TOPIC_BLOCKED: 'El correo trata un tema restringido.',
  POLICY_RESTRICTED: 'Las restricciones impiden crear el borrador.',
  POLICY_CHANGED:
    'Las restricciones o los permisos cambiaron durante la preparación.',
  POLICY_CONTEXT_REQUIRED: 'Faltan datos para comprobar las restricciones.',
  PAYMENT_REQUIRES_REVIEW: 'Los pagos necesitan revisión humana.',
  CONTRACT_REQUIRES_REVIEW:
    'Los compromisos contractuales necesitan revisión humana.',
  DISCOUNT_REQUIRES_REVIEW: 'Los descuentos necesitan revisión humana.',
  SENSITIVE_CATEGORY: 'El asunto contiene decisiones o datos sensibles.',
  REQUIRED_SOURCE_MISSING: 'Falta una fuente obligatoria.',
  UNVERIFIED_DEADLINE: 'El plazo propuesto no está verificado.',
  UNVERIFIED_COMMITMENT: 'El compromiso propuesto no está verificado.',
  HUMAN_REVIEW_REQUIRED: 'Revisa el borrador en Gmail antes de enviarlo.',
  MISSING_INFORMATION: 'Falta información para completar la respuesta.',
  UNSUPPORTED_FACT: 'Hay una afirmación sin respaldo suficiente.',
  UNSUPPORTED_COMMITMENT: 'Hay un compromiso sin respaldo.',
  UNVERIFIED_EVIDENCE: 'No se pudo verificar la evidencia.',
  NO_REPLY_REQUIRED: 'El mensaje no necesita respuesta.',
  LANGUAGE_MISMATCH: 'El idioma necesita revisión.',
  UNANSWERED_QUESTION: 'Quedan preguntas sin responder.',
  STYLE_PREFERENCE_MISMATCH:
    'La propuesta no cumple alguna preferencia de escritura.',
  KNOWLEDGE_CONFLICT: 'Las fuentes contienen información contradictoria.',
  KNOWLEDGE_NOT_CURRENT: 'Alguna fuente ya no está vigente.',
  KNOWLEDGE_INSUFFICIENT: 'Las fuentes no aportan evidencia suficiente.',
  RESPONSE_REQUIRES_REVIEW: 'La propuesta requiere revisión.',
  FACTUAL_VALIDATION_FAILED:
    'La comprobación de hechos impidió crear el borrador.',
  MISSING_EVIDENCE: 'Falta evidencia para una afirmación.',
  INVALID_CITATION: 'La referencia no respalda la afirmación.',
  VALUE_MISMATCH: 'Un valor no coincide con la evidencia.',
  CONDITION_MISMATCH: 'Las condiciones no coinciden con la evidencia.',
  TOPIC_MISMATCH: 'La evidencia no corresponde al tema.',
  RECIPIENT_MISMATCH:
    'La evidencia no está autorizada para estos destinatarios.',
  SOURCE_NOT_CURRENT: 'La fuente no está vigente.',
  UNAUTHORIZED_COMMITMENT: 'Se propuso un compromiso no autorizado.',
  SEMANTIC_REJECTION: 'La comprobación de significado rechazó la afirmación.',
  VALIDATION_CHANGED: 'El contenido cambió después de comprobarse.',
  INVALID_VALUE: 'Un valor no se pudo interpretar con seguridad.',
  AMBIGUOUS_DATE: 'La fecha es ambigua.',
  FINANCIAL: 'Contenido financiero.',
  LEGAL_CONTRACT: 'Contenido legal o contractual.',
  SENSITIVE_DATA: 'Datos sensibles.',
  HUMAN_DECISION: 'Se necesita una decisión humana.',
  GROUP_RECIPIENTS: 'Hay varios destinatarios.',
};
export function activityReason(value: string | null) {
  if (!value) return 'No hay un motivo adicional registrado.';
  if (reasons[value]) return reasons[value];
  if (
    /^(SYNC|JOB)_(GOOGLE|OPENAI)_(RATE_LIMITED|TIMEOUT|UNAVAILABLE|AUTHENTICATION|FORBIDDEN|NOT_FOUND|INVALID_RESPONSE)(_(ATTEMPTS|DEADLINE|ABORTED|BUDGET))?$/.test(
      value,
    )
  )
    return 'Un servicio externo no pudo completar la operación. Comprueba la conexión y vuelve a revisar la actividad.';
  if (
    [
      'SYNC_UNAVAILABLE',
      'JOB_UNAVAILABLE',
      'SYNC_LEASE_LOST',
      'SYNC_STOPPED',
      'SYNC_NOT_ACTIVE',
    ].includes(value)
  )
    return 'La revisión se interrumpió o no pudo completarse. Comprueba la conexión y la configuración.';
  return 'No hay una explicación disponible para este registro. Puedes revisar la conversación en Gmail.';
}
export function gmailConversationUrl(email: string | null, threadId: string) {
  if (
    !email ||
    !z.email().safeParse(email).success ||
    !gmailId.safeParse(threadId).success
  )
    return null;
  const url = new URL('https://mail.google.com/mail/u/');
  url.searchParams.set('authuser', email);
  url.hash = `all/${encodeURIComponent(threadId)}`;
  return url.toString();
}
