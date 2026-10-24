import type {
  GenerateReplyInput,
  GeneratedResponse,
} from '@/modules/response/contracts';

export const promptSecurityVersion = 'mail049-v1';
export type InjectionReason =
  | 'INSTRUCTION_OVERRIDE'
  | 'ROLE_SPOOFING'
  | 'TOOL_REQUEST'
  | 'DATA_EXFILTRATION'
  | 'PERMISSION_ESCALATION'
  | 'VERIFIER_TAMPERING';
const patterns: readonly [InjectionReason, RegExp][] = [
  [
    'INSTRUCTION_OVERRIDE',
    /\b(?:ignora\w*|omite\w*|desobedece\w*|olvida\w*|salta\w*|anula\w*|ignore\w*|disregard|override|bypass|forget|supersede|ignorer|ignorez|ignorieren|ignoriere)\b.{0,140}\b(?:instrucciones|reglas|restricciones|politicas|normas|instructions?|rules?|polic\w*|restrictions?|system|developer|prompt|instructions precedentes|regeln|anweisungen)\b/u,
  ],
  [
    'ROLE_SPOOFING',
    /<\|(?:im_start|im_end|start_header_id|end_header_id|eot_id)\|>|<\/?(?:system|developer|assistant|tool)(?:\s|>)|\[\/?(?:system|developer|inst)\]|(?:^|\n)\s*(?:system|developer|sistema|desarrollador)\s*:\s*(?:you|follow|ignore|override|eres|ignora|sigue|obedece)|\b(?:highest priority|nueva instruccion de sistema|system override|developer message|mensaje del desarrollador|you are now|ahora eres)\b/u,
  ],
  [
    'TOOL_REQUEST',
    /\b(?:ejecuta\w*|invoca\w*|llama\w*|execute|invoke|call|run)\b.{0,100}\b(?:herramienta\w*|tool\w*|mcp|gmail|supabase|sql|shell|curl|fetch|webhook|api|function|funcion)\b|\b(?:gmail\.(?:send|drafts|messages)|drafts\.(?:create|send|update|delete)|messages\.send|functions\.\w+)\b/u,
  ],
  [
    'DATA_EXFILTRATION',
    /\b(?:envia\w*|reenvia\w*|revela\w*|muestra\w*|imprime\w*|incluye\w*|copia\w*|exporta\w*|send|forward|reveal|print|include|copy|export|upload|exfiltrate|output|paste)\b.{0,140}\b(?:historial|todos los correos|otros correos|correos privados|credenciales|secretos|tokens|claves privadas|contrasenas|variables de entorno|system prompt|developer prompt|entire history|full history|mailbox|all (?:my |your |the )?(?:emails|messages|files)|private (?:data|emails|messages)|confidential|credentials|secrets|api key|access token|environment variables)\b/u,
  ],
  [
    'PERMISSION_ESCALATION',
    /\b(?:lee\w*|busca\w*|consulta\w*|accede\w*|recupera\w*|habilita\w*|activa\w*|read|search|access|retrieve|enable|load)\b.{0,100}\b(?:fuentes excluidas|fuentes no autorizadas|todos los documentos|otros buzones|otros usuarios|toda la base|calendario privado|all sources|excluded sources|unauthorized sources|private calendar|other users|entire database)\b|\b(?:cambia\w*|sustituye\w*|anade\w*|agrega\w*|redirige\w*|change|replace|add|redirect|disable)\b.{0,100}\b(?:destinatarios?|bcc|reply.to|remitente|politicas|permisos|recipients?|sender|polic\w*|permissions?|verification|verificacion)\b|"(?:allowEmailHistory|allowPartialDrafts)"\s*:\s*true|"(?:tools|tool_choice|responsePolicy|allowedSourceIds)"\s*:/iu,
  ],
  [
    'VERIFIER_TAMPERING',
    /\b(?:verificador|verifier|evaluador|validator|verification|validacion)\b.{0,100}\b(?:supported|ready|aprueba|approve|skip|omite|ignora|sin comprobar)\b|\b(?:devuelve|return|responde|respond|mark|marca)\b.{0,60}\b(?:supported|ready)\b.{0,80}(?:issues|warnings|evidence|sin verificar|without verif)|\b(?:omite|salta|skip|bypass|disable)\b.{0,60}\b(?:verificacion|validation|verifier|checks|comprobaciones)\b/u,
  ],
];
function canonical(text: string) {
  const decoded = text
    .replace(
      /&#(?:x([a-f\d]{1,6})|(\d{1,7}));?/giu,
      (all, hex: string | undefined, decimal: string | undefined) => {
        const point = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
        return point <= 0x10ffff ? String.fromCodePoint(point) : all;
      },
    )
    .replace(
      /&(lt|gt|quot|apos|amp);/giu,
      (_all, key: string) =>
        ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[
          key.toLowerCase()
        ]!,
    );
  return decoded
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(/[\t\r ]+/gu, ' ');
}
export function injectionReasons(text: string): InjectionReason[] {
  const variants = [canonical(text)];
  if (/%[a-f\d]{2}/iu.test(text))
    try {
      variants.push(canonical(decodeURIComponent(text)));
    } catch {
      /* Keep malformed data untrusted. */
    }
  // Inspect a bounded number of encoded blocks, without executing or replacing
  // the original source. UTF-8 and the same rules apply after decoding.
  for (const match of [
    ...text.matchAll(
      /(?<![A-Za-z\d+/_-])[A-Za-z\d+/_-]{40,2048}={0,2}(?![A-Za-z\d+/_-])/gu,
    ),
  ].slice(0, 8)) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(match[0], 'base64'),
      );
      if (decoded.length >= 20) variants.push(canonical(decoded));
    } catch {
      /* Binary content is not a directive. */
    }
  }
  const reasons = new Set<InjectionReason>();
  for (const variant of variants) {
    for (const candidate of [
      variant,
      variant.replace(/\s+/gu, ' '),
      variant.replace(/<[^>\n]{1,200}>/gu, '').replace(/\s+/gu, ' '),
    ])
      for (const [reason, pattern] of patterns)
        if (pattern.test(candidate)) reasons.add(reason);
  }
  return [...reasons];
}
export function hasPromptInjection(text: string) {
  return injectionReasons(text).length > 0;
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object')
    return Object.values(value).flatMap(strings);
  return [];
}
export function responseInputHasInjection(input: GenerateReplyInput) {
  // Scan content as data, never merge source keys into executable configuration.
  const surfaces = [
    input.conversation.subject ?? '',
    ...input.conversation.messages.map((m) => m.text),
    ...(input.historicalContext ?? []).map((m) => m.text),
    ...(input.knowledge ?? []).flatMap((f) => [
      f.content,
      f.source_title,
      f.document_name,
      f.section,
    ]),
    ...(input.styleExamples ?? []).map((e) => e.text),
    ...strings(input.conversation.style),
    ...(input.userInstructions ?? []),
  ];
  return surfaces.some(hasPromptInjection);
}
const credential =
  /\b(?:sk-(?:proj-)?[A-Za-z\d_-]{16,}|sb_secret_[A-Za-z\d_-]{16,}|eyJ[A-Za-z\d_-]{12,}\.[A-Za-z\d_-]{12,}\.[A-Za-z\d_-]{12,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:authorization\s*:\s*bearer|access_token\s*[=:]|refresh_token\s*[=:]|api_key\s*[=:])\s*["']?[A-Za-z\d._-]{12,}/iu;
export function responseOutputHasInjection(
  response: Pick<
    GeneratedResponse,
    'bodyText' | 'evidence' | 'missingInformation'
  >,
) {
  return [
    response.bodyText ?? '',
    ...response.missingInformation,
    ...response.evidence.flatMap((e) => [e.quote, e.claim]),
  ].some((text) => hasPromptInjection(text) || credential.test(text));
}
