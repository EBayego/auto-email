export const microsoftOAuthMessages = {
  CONNECTED: {
    title: 'Cuenta Microsoft vinculada correctamente.',
    detail: 'Ya puedes añadir una carpeta de SharePoint desde esta página.',
  },
  INVALID_OAUTH_STATE: {
    title: 'La sesión de conexión ha caducado o no coincide.',
    detail:
      'Inicia de nuevo la conexión desde esta página y completa el acceso en la misma ventana.',
  },
  MICROSOFT_IDENTITY_REJECTED: {
    title: 'No se ha podido validar la identidad de Microsoft.',
    detail:
      'Vuelve a conectar y elige una cuenta de una organización autorizada para este SharePoint.',
  },
  MICROSOFT_CLIENT_SECRET_INVALID: {
    title: 'Microsoft ha rechazado las credenciales de la aplicación.',
    detail:
      'El administrador debe revisar MICROSOFT_CLIENT_ID y el valor de MICROSOFT_CLIENT_SECRET; el identificador del secreto no sirve como valor.',
  },
  MICROSOFT_CLIENT_SECRET_EXPIRED: {
    title: 'El secreto de la aplicación Microsoft ha caducado.',
    detail:
      'El administrador debe crear un secreto vigente en Microsoft Entra y actualizar la configuración del servidor.',
  },
  MICROSOFT_APPLICATION_NOT_FOUND: {
    title: 'La aplicación no está disponible en esta organización.',
    detail:
      'El administrador debe revisar el identificador de aplicación, los inquilinos permitidos y el consentimiento de la organización.',
  },
  MICROSOFT_CONSENT_REQUIRED: {
    title: 'No se ha completado la autorización de Microsoft.',
    detail:
      'Vuelve a conectar y acepta los permisos solicitados. Tu organización puede exigir la autorización de un administrador.',
  },
  MICROSOFT_SCOPE_REQUIRED: {
    title: 'Falta el permiso de lectura de SharePoint.',
    detail:
      'Revisa los permisos delegados de Microsoft Graph y vuelve a autorizar la conexión.',
  },
  MICROSOFT_CODE_REJECTED: {
    title: 'Microsoft no ha aceptado el retorno de esta conexión.',
    detail:
      'Inicia una conexión nueva desde esta página; no reutilices ni recargues la dirección de retorno de Microsoft.',
  },
  SESSION_REQUIRED: {
    title: 'Tu sesión de Auto Email ha caducado.',
    detail: 'Inicia sesión en Auto Email y vuelve a conectar Microsoft.',
  },
  PRIVACY_CONSENT_REQUIRED: {
    title: 'Debes revisar la autorización de privacidad.',
    detail:
      'Acepta la información de privacidad vigente antes de volver a conectar Microsoft.',
  },
  CONNECTOR_UNAVAILABLE: {
    title: 'No se ha podido guardar o recuperar la conexión.',
    detail:
      'Vuelve a intentarlo. Si persiste, el administrador debe revisar la base de datos y las migraciones del conector.',
  },
  CONNECTOR_DISABLED: {
    title: 'La conexión con SharePoint está desactivada.',
    detail:
      'El administrador debe completar y activar el conector en el servidor.',
  },
  CREDENTIAL_UNAVAILABLE: {
    title: 'No se han podido recuperar las credenciales de conexión.',
    detail:
      'Inicia una conexión nueva. Si persiste, el administrador debe revisar la clave de cifrado del servidor.',
  },
  MICROSOFT_UNAVAILABLE: {
    title: 'No se ha completado la vinculación con Microsoft.',
    detail:
      'Autorizar el acceso en Microsoft no basta si falla el retorno a Auto Email. Vuelve a conectar; si persiste, consulta el log del servidor con el código de este aviso.',
  },
} as const;

export type MicrosoftOAuthStatus = keyof typeof microsoftOAuthMessages;
export function microsoftOAuthStatus(value: unknown): MicrosoftOAuthStatus {
  return typeof value === 'string' &&
    Object.hasOwn(microsoftOAuthMessages, value)
    ? (value as MicrosoftOAuthStatus)
    : 'MICROSOFT_UNAVAILABLE';
}
