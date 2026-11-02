import { z } from 'zod';

export const privacyNoticeVersion = 'mail061-v1';
export const sharePointPrivacySection = {
  title: 'Fuentes opcionales de SharePoint y OCR',
  text: 'Si conectas Microsoft 365, Auto Email leerá las carpetas y subcarpetas que elijas y mantendrá un índice local de sus textos, versiones y referencias para fundamentar respuestas. Los originales permanecen en SharePoint; las descargas se procesan temporalmente. Los permisos de Microsoft pueden abarcar más recursos que la selección de la aplicación, cuyo alcance eliges al conectar. Las credenciales se guardan cifradas. Los fragmentos pertinentes pueden enviarse a OpenAI para preparar y comprobar borradores. Cuando se configura OCR, los documentos e imágenes que lo requieren se envían al recurso Azure Document Intelligence del operador. Los proveedores, regiones y plazos efectivos se detallan por el operador. Las reglas y las restricciones de destinatarios controlan el uso de cada fuente. Desconectar una carpeta o cuenta retira sus textos e índices locales. Retirar esta autorización pausa los conectores, elimina sus credenciales y bloquea nuevos accesos; puedes exportar o retirar los derivados conservados. Los borradores ya creados en Gmail permanecen para tu revisión. Una petición enviada a un proveedor puede terminar.',
};
export const privacyGrantText =
  'He leído esta información y autorizo a Auto Email a acceder a mi Gmail y comunicar a OpenAI el contenido necesario para las funciones descritas de mi cuenta. Puedo retirar este permiso desde Ajustes.';
export const privacySections = [
  {
    title: 'Qué leemos y para qué',
    text: 'Auto Email consulta tu dirección Gmail, cabeceras, participantes, etiquetas y el contenido de los mensajes e hilos necesarios para seleccionar correos, recuperar contexto y preparar respuestas. El análisis inicial de enviados tiene su propio permiso y alcance. Los adjuntos de Gmail no se descargan automáticamente. Solo creamos borradores: tú revisas y envías desde Gmail. El permiso gmail.compose permite técnicamente enviar, pero Auto Email no implementa esa función.',
  },
  {
    title: 'Proveedores y comunicación de datos',
    text: 'Google proporciona Gmail y la autorización OAuth. Supabase almacena la cuenta, configuración, credenciales cifradas, perfiles, referencias y documentos que subas. OpenAI recibe los fragmentos de correo, contexto, ejemplos de estilo y documentos pertinentes para clasificar y generar texto mediante su API. La aplicación solicita no almacenar el estado de las respuestas (store: false); esto no garantiza retención cero en los registros del proveedor. El alojamiento de la aplicación y los detalles de procesamiento se identifican más abajo.',
  },
  {
    title: 'Personalización y límites de uso',
    text: 'Los datos de Gmail se utilizan para las funciones visibles de tu propia cuenta. No se venden, no se usan para publicidad y no se utilizan para desarrollar o entrenar modelos generales ni para personalizar otras cuentas. No se concede acceso humano ordinario al contenido; cualquier acceso excepcional debe ajustarse a las políticas de Google y a la legislación aplicable. El uso y la transferencia de información recibida de las API de Google se ajustarán a Google API Services User Data Policy, incluidos los requisitos de Limited Use, y a Google Workspace API User Data and Developer Policy.',
  },
  {
    title: 'Qué conservamos',
    text: 'No copiamos tu buzón: los cuerpos recuperados se procesan en memoria. El historial detallado de trabajos, generaciones y comparaciones caduca a los 90 días; los registros de eventos a los 30 días. Tras la purga conservamos referencias mínimas y una huella del mensaje para evitar borradores duplicados mientras exista la cuenta. Los perfiles derivados caducan tras 90 días sin actividad de la cuenta; la configuración explícita y los documentos e índices permanecen hasta que los borres. Guardar el texto de borradores para comparar ediciones es opcional, está desactivado por defecto y exige una autorización independiente de entre 1 y 168 horas. Los textos vencidos se dejan de utilizar y se purgan en el siguiente ciclo de cinco minutos; retirar el permiso elimina las copias pendientes. El aprendizaje automático de saludos y despedidas tiene otro permiso independiente. Los tokens se conservan cifrados hasta la desconexión y los códigos de autorización se purgan al caducar. Las cookies de sesión son necesarias y tienen un plazo de siete días, renovable al actualizar la sesión. El registro mínimo de operaciones de borrado y su resguardo duran 30 días. Conservamos las aceptaciones y retiradas de privacidad mientras exista tu cuenta; se eliminan con ella. Un registro cifrado mínimo de supresiones, separado de la base, permite reaplicar los borrados después de restaurar una copia; debe conservarse mientras existan copias que puedan recuperar esos datos. Los plazos de copias de seguridad y registros de proveedores se detallan por el operador.',
  },
  {
    title: 'Tus controles y derechos',
    text: 'Desde Ajustes puedes retirar esta autorización, desconectar Gmail, borrar tu estilo, eliminar documentos y solicitar el borrado de la cuenta. Retirar el permiso detiene los nuevos accesos y trabajos, pausa Gmail, cancela el análisis y elimina las autorizaciones opcionales y sus textos temporales; no borra tus correos ni los borradores de Gmail. Una petición ya enviada a un proveedor puede terminar. Puedes retirar también el acceso en tu cuenta de Google. Puedes descargar tus datos desde Ajustes y contactar con el operador para acceso, rectificación, supresión, limitación, oposición o portabilidad cuando correspondan. Puedes reclamar ante la autoridad de protección de datos competente, incluida la AEPD en España.',
  },
  {
    title: 'Condiciones y datos de terceros',
    text: 'Este servicio prepara propuestas que debes revisar por su contenido, destinatarios y adjuntos antes de enviarlas. Conecta únicamente cuentas y fuentes para las que tengas autorización. El permiso OAuth y esta autorización de uso no sustituyen la base jurídica ni la información debida a remitentes, empleados y otros terceros. En un uso profesional, el cliente determina los fines de su correspondencia y el operador puede actuar como encargado; el contrato de tratamiento y los subencargados deben revisarse antes del piloto comercial. La identidad del operador, el tratamiento de los datos de cuenta, las bases jurídicas, las transferencias y la valoración de riesgos y de una evaluación de impacto se concretan en la información del operador.',
  },
] as const;

export const privacyOperationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('grant'),
      version: z.literal(privacyNoticeVersion),
      noticeHash: z.string().regex(/^[a-f0-9]{64}$/),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('withdraw') }).strict(),
]);
export type PrivacyOperation = z.infer<typeof privacyOperationSchema>;
export type PrivacyStatus = {
  authorized: boolean;
  acceptedAt: string | null;
  withdrawnAt: string | null;
  version: string | null;
  events: {
    id: string;
    action: string;
    notice_version: string;
    created_at: string;
  }[];
};

export class PrivacyError extends Error {
  constructor(
    public readonly code:
      | 'PRIVACY_CONFIGURATION_REQUIRED'
      | 'PRIVACY_CONSENT_REQUIRED'
      | 'STALE_PRIVACY_NOTICE',
  ) {
    super(code);
    this.name = 'PrivacyError';
  }
}
