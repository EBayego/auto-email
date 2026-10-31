import type { AutomationSettings } from './automation-settings';

export const intentLabels = {
  REQUEST_INFORMATION: 'Solicitudes de información',
  REQUEST_ACTION: 'Solicitudes de acción',
  CONFIRMATION: 'Confirmaciones',
  FOLLOW_UP: 'Seguimientos',
  MEETING: 'Reuniones',
  COMPLAINT: 'Reclamaciones',
  FINANCIAL: 'Consultas financieras',
  LEGAL_CONTRACT: 'Asuntos legales o contractuales',
  NOTIFICATION: 'Notificaciones',
  UNKNOWN: 'Sin determinar',
} as const;
export const requirementLabels = {
  PRICE: 'Precios',
  DEADLINE: 'Plazos',
  HOURS: 'Horarios',
  PROCEDURE: 'Procedimientos',
  FACT: 'Otros datos',
} as const;
export const scopeLabels = {
  ALL_INCOMING: 'Todos los entrantes',
  INBOX: 'Solo bandeja de entrada',
  UNREAD_INBOX: 'Solo no leídos de la bandeja de entrada',
} as const;
export const settingsMessages: Record<string, string> = {
  INVALID_INPUT: 'Revisa los campos, las direcciones y los límites indicados.',
  SETTINGS_CHANGED:
    'La configuración ha cambiado en otra sesión. Recárgala antes de guardar.',
  UNAVAILABLE: 'No se ha podido guardar la configuración. Vuelve a intentarlo.',
  FORBIDDEN: 'No tienes acceso a esta configuración.',
  UNAUTHENTICATED: 'La sesión ha caducado. Vuelve a iniciar sesión.',
};
export const splitSettingsList = (value: string) => [
  ...new Set(
    value
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
export function applyRestrictionInstructions(
  text: string,
  settings: AutomationSettings,
): AutomationSettings {
  if (
    !text.trim() ||
    text.length > 2000 ||
    /[\p{Cc}\p{Cf}]/u.test(text.replace(/[\n\r\t]/g, ''))
  )
    throw new Error('INVALID_INSTRUCTIONS');
  const next = structuredClone(settings);
  const lines = text
    .split(/[\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.length > 10) throw new Error('INVALID_INSTRUCTIONS');
  for (const line of lines) {
    const match =
      /^(no responder sobre|excluir remitente|excluir dominio)\s+(.+)$/iu.exec(
        line,
      );
    if (!match) throw new Error('INVALID_INSTRUCTIONS');
    const value = match[2]!.trim();
    if (match[1]!.toLowerCase() === 'no responder sobre') {
      if (value.length > 80) throw new Error('INVALID_INSTRUCTIONS');
      next.policy.blockedTopics.push(value);
    } else if (match[1]!.toLowerCase() === 'excluir remitente') {
      if (!/^[^\s<>@]+@[^\s<>@]+$/u.test(value))
        throw new Error('INVALID_INSTRUCTIONS');
      next.excludedAddresses.push(value);
    } else {
      if (!/^[\p{L}\p{N}.-]+$/u.test(value))
        throw new Error('INVALID_INSTRUCTIONS');
      next.excludedDomains.push(value);
    }
  }
  next.policy.blockedTopics = [...new Set(next.policy.blockedTopics)];
  next.excludedAddresses = [...new Set(next.excludedAddresses)];
  next.excludedDomains = [...new Set(next.excludedDomains)];
  if (
    next.policy.blockedTopics.length > 30 ||
    next.excludedAddresses.length > 100 ||
    next.excludedDomains.length > 100
  )
    throw new Error('INVALID_INSTRUCTIONS');
  return next;
}
