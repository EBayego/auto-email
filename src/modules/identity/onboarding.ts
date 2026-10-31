import { z } from 'zod';

export const onboardingConsentVersion = 'mail051-v1';
export const activeAnalysisStates = ['QUEUED', 'SAMPLING', 'ANALYZING'];
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  );
export const analysisScopeSchema = z.strictObject({
  after: date,
  before: date,
  maxCandidates: z.union([z.literal(200), z.literal(500)]),
  excludedAddresses: z
    .array(
      z
        .string()
        .max(254)
        .regex(/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/),
    )
    .max(100),
  excludedDomains: z
    .array(
      z
        .string()
        .max(253)
        .regex(
          /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)*[a-z\d](?:[a-z\d-]*[a-z\d])?$/,
        ),
    )
    .max(100),
});
export type AnalysisScope = z.infer<typeof analysisScopeSchema>;
export class OnboardingError extends Error {
  constructor(
    public readonly code:
      | 'CONSENT_REQUIRED'
      | 'STALE_CONSENT'
      | 'ANALYSIS_BUSY'
      | 'NOT_CONNECTED'
      | 'CANCELLED'
      | 'INVALID_INPUT'
      | 'UNAVAILABLE',
  ) {
    super(code);
    this.name = 'OnboardingError';
  }
}
const operationSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('consent'),
    consent: z.literal(true),
    version: z.literal(onboardingConsentVersion),
    scope: analysisScopeSchema,
  }),
  z.strictObject({ action: z.enum(['start', 'cancel']), revision: z.uuid() }),
]);
export function parseOnboardingOperation(input: unknown, now = new Date()) {
  const parsed = operationSchema.safeParse(input);
  if (!parsed.success) throw new OnboardingError('INVALID_INPUT');
  if (parsed.data.action === 'consent') {
    const scope = parsed.data.scope;
    if (
      scope.after < '1970-01-02' ||
      scope.after >= scope.before ||
      scope.before > now.toISOString().slice(0, 10)
    )
      throw new OnboardingError('INVALID_INPUT');
    scope.excludedAddresses = [
      ...new Set(scope.excludedAddresses.map((value) => value.toLowerCase())),
    ];
    scope.excludedDomains = [...new Set(scope.excludedDomains)];
  }
  return parsed.data;
}
export type OnboardingOperation = ReturnType<typeof parseOnboardingOperation>;
export type OnboardingRecord = {
  consent_revision: string;
  consent_version: string;
  consented_at: string;
  scope: AnalysisScope;
  status: string;
  scanned: number;
  selected: number;
  profile_revision: string | null;
  error_code: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};
export const onboardingMessages: Record<string, string> = {
  CONSENT_REQUIRED:
    'Acepta el consentimiento y guarda el alcance antes de iniciar el análisis.',
  STALE_CONSENT:
    'El alcance ha cambiado en otra ventana. Recarga la página y revísalo.',
  ANALYSIS_BUSY:
    'Ya hay un análisis en curso. Puedes cancelarlo antes de cambiar el alcance.',
  NOT_CONNECTED: 'Conecta o reactiva Gmail para analizar el historial.',
  EMPTY_SAMPLE:
    'No hemos encontrado mensajes enviados útiles en ese intervalo. Amplía las fechas o revisa las exclusiones y vuelve a intentarlo.',
  REAUTH_REQUIRED:
    'La autorización de Gmail ha caducado o faltan permisos. Vuelve a conectar la cuenta.',
  ANALYSIS_INTERRUPTED:
    'El análisis se ha interrumpido. Puedes solicitarlo de nuevo.',
  PROVIDER_UNAVAILABLE:
    'Gmail o el servicio de análisis no están disponibles. Vuelve a intentarlo más tarde.',
  INVALID_PROFILE:
    'No se ha podido obtener un perfil de escritura válido. Puedes reintentar el análisis.',
  CANCELLED:
    'Análisis cancelado. No se guardarán resultados de esta ejecución.',
  INVALID_INPUT: 'Revisa las fechas, el límite de mensajes y las exclusiones.',
  UNAVAILABLE: 'No se ha podido completar la operación. Vuelve a intentarlo.',
};
