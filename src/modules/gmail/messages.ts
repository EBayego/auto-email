export const gmailOAuthMessages = {
  CHECKED: 'La conexión con Gmail funciona correctamente.',
  DISCONNECT_PENDING:
    'Hay una desconexión pendiente. Pulsa «Desconectar Gmail y revocar acceso» para completarla antes de volver a conectar.',
  DISCONNECTED:
    'Gmail se ha desconectado y se ha revocado el acceso en Google.',
  REVOCATION_FAILED:
    'Gmail está desconectado de Auto Email. No hemos podido confirmar la revocación en Google; elimina también el acceso desde los permisos de tu cuenta Google.',
  REAUTH_REQUIRED:
    'La autorización de Gmail ha caducado o se ha revocado. Pulsa «Volver a conectar Gmail» para conceder acceso de nuevo.',
  NOT_CONNECTED:
    'Gmail está desconectado. Conecta tu cuenta para volver a utilizarla.',
  PAUSED: 'La cuenta Gmail está pausada.',
  TOKEN_BUSY:
    'La conexión con Gmail está siendo actualizada. Inténtalo de nuevo dentro de unos segundos.',
  CONNECTED: 'Gmail se ha conectado correctamente.',
  INVALID_STATE:
    'La conexión ha caducado o pertenece a otra sesión. Vuelve a conectar Gmail.',
  CANCELLED: 'Has cancelado la conexión con Gmail. Puedes intentarlo de nuevo.',
  AUTHORIZATION_FAILED:
    'Google no ha autorizado la conexión. Vuelve a intentarlo.',
  MISSING_SCOPES:
    'Necesitamos los dos permisos solicitados para leer correos y preparar borradores. Vuelve a conectar Gmail y acepta ambos.',
  REFRESH_TOKEN_REQUIRED:
    'Google no ha concedido acceso para trabajar con Gmail cuando cierres la aplicación. Vuelve a conectar tu cuenta y confirma los permisos.',
  INVALID_PROFILE:
    'No hemos podido identificar la cuenta de Gmail. Vuelve a intentarlo.',
  ACCOUNT_MISMATCH:
    'Ya tienes otra cuenta Gmail vinculada. Vuelve a conectar esa misma cuenta.',
  ACCOUNT_IN_USE:
    'Esta cuenta Gmail ya está vinculada a otra cuenta de Auto Email.',
  UNAVAILABLE:
    'No se ha podido completar la conexión con Gmail. Vuelve a intentarlo.',
} as const;
